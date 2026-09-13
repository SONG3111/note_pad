// 待办提醒调度:常驻后台线程,每 15 秒扫描一次到期的待办项并发系统通知。
// 应用关闭到托盘后进程仍驻留,主窗口隐藏不影响提醒触发;
// 系统休眠期间错过的提醒会在唤醒后的首次扫描补发(条件是 remind_at <= now)。

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::db::{self, Db};
use crate::i18n;

const TICK: Duration = Duration::from_secs(15);

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || loop {
        // 先扫描再休眠:启动时立即补发关闭期间错过的提醒,不等首个周期
        if let Err(e) = tick(&app) {
            eprintln!("提醒调度失败({e}),下个周期重试");
        }
        std::thread::sleep(TICK);
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
    let title = i18n::current(app).todo_reminder();
    for r in &claimed {
        let body = match &r.note_title {
            Some(t) => format!("{t} · {}", r.text),
            None => r.text.clone(),
        };
        if let Err(e) = app.notification().builder().title(title).body(body).show() {
            eprintln!("系统通知发送失败({e})");
        }
    }

    // 一批提醒只播一声提示音;无声卡/设备占用失败不影响通知本身
    if let Err(e) = crate::sound::play_chime() {
        eprintln!("提醒音效播放失败({e})");
    }

    // 按笔记去重广播变更,前端拉取后铃铛随之消失
    let mut touched: Vec<String> = Vec::new();
    for r in &claimed {
        if !touched.contains(&r.note_id) {
            touched.push(r.note_id.clone());
        }
    }
    for note_id in touched {
        let _ = app.emit("notes-changed", crate::changed_payload(&note_id, "reminder"));
    }
    Ok(())
}
