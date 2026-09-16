// 待办提醒调度:常驻后台线程,按最近的提醒截止时间精确休眠,到点发系统通知。
// 应用关闭到托盘后进程仍驻留,主窗口隐藏不影响提醒触发;
// 系统休眠期间错过的提醒会在唤醒后的首次扫描补发(条件是 remind_at <= now);
// 用户改设提醒时由 set_todo_reminder 命令调用 wake() 立即打断休眠重扫。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::db::{self, Db};
use crate::i18n;

/// 无提醒时的空闲扫描周期;也是系统时钟被手动改动的最大发现延迟
/// (wait_timeout 走单调时钟,时钟突变最迟一个周期内被重扫纠正)
const IDLE_TICK: Duration = Duration::from_secs(15);

/// 调度线程的休眠唤醒器:设置新提醒后必须立即打断休眠,
/// 否则近刻提醒要等当前休眠(最长 15 秒)结束才会被发现
static WAKE: OnceLock<(Mutex<()>, Condvar)> = OnceLock::new();

fn wake_state() -> &'static (Mutex<()>, Condvar) {
    WAKE.get_or_init(|| (Mutex::new(()), Condvar::new()))
}

/// 唤醒调度线程立即重扫(不区分唤醒原因,任何唤醒都多扫一次,开销可忽略)
pub fn wake() {
    let (lock, cvar) = wake_state();
    let _guard = lock.lock().unwrap();
    cvar.notify_all();
}

/// 提示音播放互斥:上一批还在播(或音频设备初始化中)时跳过本批铃声,
/// 避免连续批次在独立线程上叠加多条音频流
static CHIME_PLAYING: AtomicBool = AtomicBool::new(false);

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || loop {
        // 先扫描再休眠:启动时立即补发关闭期间错过的提醒,不等首个周期
        if let Err(e) = tick(&app) {
            eprintln!("提醒调度失败({e}),下个周期重试");
        }
        // 必须先取唤醒锁再计算休眠截止:wake() 若落在"读库之后、进入等待之前"
        // 会 notify 一个还不存在的等待者而丢失(丢失唤醒),新提醒最坏被拖满
        // 当前周期(15 秒)。持锁计算后,wake 只能在读库前(截止已含新提醒)或
        // wait 释放锁后(notify 命中等待者)发生。wake 的调用方从不持有 DB 锁,
        // 这里的"唤醒锁 → DB 锁"顺序不与任何反序组合成环,无死锁风险。
        let (lock, cvar) = wake_state();
        let guard = lock.lock().unwrap();
        // 最近的待触发提醒时间作为休眠截止:锁/查询失败按无提醒处理,退回空闲周期
        let deadline = {
            let db = app.state::<Db>();
            db.0.lock()
                .ok()
                .and_then(|conn| db::next_remind_at(&conn).ok().flatten())
        };
        let wait = deadline
            .map(|ms| Duration::from_millis((ms - db::now_ms()).max(0) as u64))
            .unwrap_or(IDLE_TICK)
            .min(IDLE_TICK);
        let _ = cvar.wait_timeout(guard, wait);
    });
}

fn tick(app: &AppHandle) -> Result<(), String> {
    let due = {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|_| "DB_BUSY".to_string())?;
        db::due_reminders(&conn, db::now_ms()).map_err(|e| e.to_string())?
    };
    if due.is_empty() {
        return Ok(());
    }

    // 先用乐观锁"认领"(清除)扫描到的提醒,清除成功的才归本次触发所有:
    // 扫描后用户改设新提醒或勾选完成都会使 remind_at 失配 → 跳过通知,
    // 也避免清除失败时下个周期对同一条重复通知
    let claimed = {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|_| "DB_BUSY".to_string())?;
        let mut claimed = Vec::new();
        for r in &due {
            match db::clear_due_reminder(&conn, &r.item_id, r.remind_at) {
                Ok(true) => {
                    if let Err(e) = db::touch_note(&conn, &r.note_id) {
                        eprintln!("刷新笔记时间失败({e})");
                    }
                    claimed.push(r.clone());
                }
                Ok(false) => {}
                Err(e) => eprintln!("清除已触发提醒失败({e})"),
            }
        }
        claimed
    };
    if claimed.is_empty() {
        return Ok(());
    }

    // 通知文案:标题按当前语言本地化,正文 = 笔记标题 · 待办文本
    // try_state 容错:语言状态尚未注册时(异常启动顺序)不 panic,回退中文
    let title = app
        .try_state::<i18n::AppState>()
        .map(|s| s.current())
        .unwrap_or(i18n::AppLocale::Zh)
        .todo_reminder();

    // 按笔记去重广播变更,前端拉取后铃铛随之消失(不等待通知发送完成)
    let mut touched: Vec<String> = Vec::new();
    for r in &claimed {
        if !touched.contains(&r.note_id) {
            touched.push(r.note_id.clone());
        }
    }
    for note_id in touched {
        let _ = app.emit(
            "notes-changed",
            crate::changed_payload(&note_id, "reminder"),
        );
    }

    // 发送与提示音整体移到独立线程:CreateToastNotifierWithId 等 COM 调用偶发秒级阻塞,
    // 不能拖住调度线程的下一轮截止时间计算(否则同批之后几秒内到期的提醒会被推迟);
    // 线程内逐条串行保持顺序
    let notify_app = app.clone();
    std::thread::spawn(move || {
        let mut delivered = 0usize;
        for r in &claimed {
            let body = match &r.note_title {
                Some(t) => format!("{t} · {}", r.text),
                None => r.text.clone(),
            };
            // 单入口发送(正确的应用图标);失败回退插件通知(未打包构建即 PowerShell 图标);
            // 两条路径都失败则回写 remind_at,下个周期重试,避免提醒被认领后静默丢失
            if crate::notify::send(&notify_app, title, &body).is_err() {
                if let Err(e) = notify_app.notification().builder().title(title).body(body).show() {
                    eprintln!("系统通知发送失败({e}),回写提醒待下个周期重试");
                    let restored = {
                        let db = notify_app.state::<Db>();
                        // 先绑定锁结果再 if let:临时 Guard 的存活期不能越过 db 本身
                        let lock = db.0.lock();
                        match lock {
                            Ok(conn) => match db::restore_reminder(&conn, &r.item_id, r.remind_at) {
                                Ok(v) => v,
                                Err(e) => {
                                    eprintln!("回写提醒失败({e})");
                                    false
                                }
                            },
                            Err(_) => false,
                        }
                    };
                    // 回写后不唤醒调度线程:通知路径持续故障时,唤醒-认领-再失败-再回写
                    // 会形成无退避的忙循环(每轮还堆积一条通知线程)。本轮回写前调度线程
                    // 已按"无提醒"算好空闲周期(15 秒),最迟一个周期后自然重试
                    if !restored {
                        eprintln!("回写提醒未生效(期间用户已改设新提醒),跳过重试");
                    }
                } else {
                    delivered += 1;
                }
            } else {
                delivered += 1;
            }
        }

        // 一批提醒只播一声提示音,在本线程播放不占用调度扫描;
        // 仅当至少一条真正送达才播:全部失败时静默,由 ≤15 秒的重试循环在
        // 送达那一轮补播,避免通知故障期间每个周期空鸣一声
        if delivered > 0 && !CHIME_PLAYING.swap(true, Ordering::SeqCst) {
            if let Err(e) = crate::sound::play_chime() {
                eprintln!("提醒音效播放失败({e})");
            }
            CHIME_PLAYING.store(false, Ordering::SeqCst);
        }
    });
    Ok(())
}
