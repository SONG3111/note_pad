mod db;
#[cfg(desktop)]
mod i18n;
#[cfg(desktop)]
mod dock;
mod reminder;
mod reminder_popup;
mod notify;
mod sound;

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};

use db::{Db, NoteWithItems, TodoItem};

pub(crate) type CmdResult<T> = Result<T, String>;

/// 在阻塞线程池执行数据库操作:主线程与异步运行时都不会被卡住。
/// 锁被污染时返回友好错误而不是 panic。
pub(crate) async fn with_conn<T, F>(db: Arc<Mutex<rusqlite::Connection>>, f: F) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(&rusqlite::Connection) -> CmdResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        // 错误以稳定码返回,用户可见文案由前端按语言翻译(见 src/i18n/locales)
        let conn = db.lock().map_err(|_| "DB_BUSY".to_string())?;
        f(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 变更事件负载:携带来源窗口标签,接收方可跳过自己发出的变更,避免无谓回拉
pub(crate) fn changed_payload(id: &str, source: &str) -> serde_json::Value {
    serde_json::json!({ "id": id, "source": source })
}

#[tauri::command]
async fn list_notes(state: State<'_, Db>) -> CmdResult<Vec<NoteWithItems>> {
    with_conn(state.0.clone(), |conn| db::list_notes(conn).map_err(|e| e.to_string())).await
}

#[tauri::command]
async fn get_note(state: State<'_, Db>, id: String) -> CmdResult<NoteWithItems> {
    with_conn(state.0.clone(), move |conn| {
        db::get_note(conn, &id).map_err(|e| {
            // 稳定的错误契约:前端依赖 NOTE_NOT_FOUND 区分"已删除"与瞬时 DB 错误
            if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                "NOTE_NOT_FOUND".to_string()
            } else {
                e.to_string()
            }
        })
    })
    .await
}

/// 独立便签窗口的固定内容尺寸(逻辑 px),与抓取点钳制共用
const NOTE_WINDOW_W: f64 = 360.0;
const NOTE_WINDOW_H: f64 = 380.0;
/// 抓取点在窗口内的最小边距(逻辑 px):卡片可能比窗口大,
/// 手指捏住的部位按最近等价位置落进窗口,避免捏着边缘时窗口飘出光标外
const GRAB_MARGIN_X: f64 = 24.0;
const GRAB_MARGIN_Y: f64 = 20.0;

/// 拖出/按钮脱离时的定位参数(全部可选,缺省回退旧行为)
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DetachOrigin {
    /// 触发时刻的光标物理坐标(前端由事件坐标+窗口变换换算,无实时查询延迟)
    cursor_x: Option<i32>,
    cursor_y: Option<i32>,
    /// 光标在源卡片内的偏移(CSS px):新窗口按它锚定,实现零跳变交接
    grab_dx: Option<f64>,
    grab_dy: Option<f64>,
}

/// 抓取点钳制进窗口尺寸(逻辑 px)
fn clamp_grab(grab: (f64, f64)) -> (f64, f64) {
    (
        grab.0.clamp(GRAB_MARGIN_X, NOTE_WINDOW_W - GRAB_MARGIN_X),
        grab.1.clamp(GRAB_MARGIN_Y, NOTE_WINDOW_H - GRAB_MARGIN_Y),
    )
}

/// 由光标物理坐标与抓取点计算新窗口左上角的逻辑坐标(建窗用;纯函数便于单测)。
/// 零跳变交接的关键:窗口落点 = 光标 − 抓取偏移,手指捏住卡片的哪个部位,
/// 新窗口的同一部位就在手指下面,拖出瞬间内容不再跳位
fn detach_position(cursor: (f64, f64), grab: (f64, f64), scale: f64) -> (f64, f64) {
    let g = clamp_grab(grab);
    ((cursor.0 - g.0 * scale) / scale, (cursor.1 - g.1 * scale) / scale)
}

/// 光标所在显示器的缩放(找不到时回退主显示器,再回退 1.0):
/// 多显示器缩放不同,固定用主显示器换算会让窗口在副屏上错位
fn scale_at(app: &AppHandle, x: f64, y: f64) -> f64 {
    let containing = app.available_monitors().ok().and_then(|mons| {
        mons.into_iter().find(|m| {
            let p = m.position();
            let s = m.size();
            x >= p.x as f64
                && x < p.x as f64 + s.width as f64
                && y >= p.y as f64
                && y < p.y as f64 + s.height as f64
        })
    });
    containing
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|m| m.scale_factor())
        .unwrap_or(1.0)
}

/// 独立便签窗口首次被用户拖动时注册进停靠管理(前端 onMoved 触发):
/// 新建窗口的落点不受"边缘停留即吸附"影响,贴边只源于用户后续的主动拖动
#[tauri::command]
async fn register_note_dock(app: AppHandle, label: String) -> CmdResult<()> {
    if !label.starts_with("note-") {
        return Err("BAD_LABEL".into());
    }
    if app.get_webview_window(&label).is_some() {
        dock::register(label);
    }
    Ok(())
}

/// 把便签从主界面拖出为独立窗口。
/// 前端两段式手势:松手且拖动超过脱离距离后才调用,纸片飞向本窗口落点完成交接,
/// 因此不再做拖拽中途的窗口接管(旧 start_dragging 已移除)。
#[tauri::command]
async fn detach_note_window(
    app: AppHandle,
    state: State<'_, Db>,
    id: String,
    origin: Option<DetachOrigin>,
) -> CmdResult<()> {
    // 确认笔记存在(阻塞操作放线程池,不占用异步运行时线程)
    let check_id = id.clone();
    with_conn(state.0.clone(), move |conn| db::get_note(conn, &check_id).map(|_| ()).map_err(|e| e.to_string())).await?;

    let label = format!("note-{id}");
    if let Some(existing) = app.get_webview_window(&label) {
        // 若处于贴边隐藏状态,点击搜索结果时一并唤出,避免用户只看到 6px 露出条而困惑
        #[cfg(desktop)]
        dock::request_show(&label);
        let _ = existing.set_focus();
        return Ok(());
    }

    #[cfg(desktop)]
    {
        use tauri::WebviewUrl;
        let o = origin.unwrap_or_default();
        // 光标物理坐标:拖拽路径由前端随事件携带(无查询延迟);缺省回退后端实时查询
        let (cx, cy) = match (o.cursor_x, o.cursor_y) {
            (Some(x), Some(y)) => (x as f64, y as f64),
            _ => {
                let cp = app.cursor_position().map_err(|e| e.to_string())?;
                (cp.x, cp.y)
            }
        };
        let scale = scale_at(&app, cx, cy);
        // 抓取点缺省 ≈ 旧版落点习惯(窗口中上),按钮路径与锚定语义保持一致
        let grab = (
            o.grab_dx.unwrap_or(NOTE_WINDOW_W * 0.5),
            o.grab_dy.unwrap_or(GRAB_MARGIN_Y + 4.0),
        );
        let (x, y) = detach_position((cx, cy), grab, scale);
        // 入场动画原点 = 钳制后的抓取点(窗口内逻辑坐标),经查询参数交给新窗口
        let (gx, gy) = clamp_grab(grab);
        let url = format!("index.html?detach=1&gx={:.0}&gy={:.0}", gx, gy);

        // 隐身创建:webview 加载期间落点处不能先闪出空白窗框;
        // 由 NoteWindowApp 首帧渲染完成后自行 show()+set_focus(),与主窗口纸片同帧交接
        tauri::WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
            .title(i18n::current(&app).app_title())
            .inner_size(NOTE_WINDOW_W, NOTE_WINDOW_H)
            .position(x, y)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
        // 注意:此处不注册停靠管理(dock)。新窗口落点可能在屏幕边缘附近,
        // 立即注册会被 dock 的"边缘停留即吸附"逻辑当场贴边隐藏;
        // 由 NoteWindowApp 在窗口首次被用户拖动时调用 register_note_dock 注册
    }
    Ok(())
}

/// 切换应用语言(前端手动切换时调用):更新全局状态并重建托盘。
/// 窗口标题由前端自行 setTitle,这里只管 Rust 侧创建的托盘文案。
#[tauri::command]
async fn set_app_locale(app: AppHandle, locale: String) -> CmdResult<()> {
    let loc = i18n::AppLocale::from_tag(&locale);
    {
        let state = app.state::<i18n::AppState>();
        let mut cur = state.0.lock().map_err(|_| "DB_BUSY".to_string())?;
        *cur = loc;
    }
    #[cfg(desktop)]
    i18n::rebuild_tray(&app, loc).map_err(|e| e.to_string())?;
    // 通知顶部的应用名(开始菜单快捷方式)跟随语言:后台线程重写,不阻塞命令返回
    {
        let handle = app.clone();
        std::thread::spawn(move || crate::notify::sync_display_name(&handle));
    }
    Ok(())
}

/// 切换任意窗口的置顶状态
#[tauri::command]
async fn set_window_on_top(app: AppHandle, label: String, top: bool) -> CmdResult<()> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| "WINDOW_NOT_FOUND".to_string())?;
    win.set_always_on_top(top).map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_note(app: AppHandle, window: tauri::Window, state: State<'_, Db>, input: db::CreateNoteInput) -> CmdResult<NoteWithItems> {
    let note = with_conn(state.0.clone(), move |conn| db::create_note(conn, &input).map_err(|e| e.to_string())).await?;
    let _ = app.emit("notes-changed", changed_payload(&note.note.id, window.label()));
    Ok(note)
}

#[tauri::command]
async fn update_note(app: AppHandle, window: tauri::Window, state: State<'_, Db>, id: String, input: db::UpdateNoteInput) -> CmdResult<NoteWithItems> {
    let note = with_conn(state.0.clone(), move |conn| db::update_note(conn, &id, &input)).await?;
    let _ = app.emit("notes-changed", changed_payload(&note.note.id, window.label()));
    Ok(note)
}

#[tauri::command]
async fn delete_note(app: AppHandle, window: tauri::Window, state: State<'_, Db>, id: String) -> CmdResult<()> {
    let id = with_conn(state.0.clone(), move |conn| db::delete_note(conn, &id).map(|()| id)).await?;
    let _ = app.emit("notes-changed", changed_payload(&id, window.label()));
    Ok(())
}

#[tauri::command]
async fn add_todo_item(app: AppHandle, window: tauri::Window, state: State<'_, Db>, note_id: String, text: String) -> CmdResult<TodoItem> {
    let item = with_conn(state.0.clone(), move |conn| db::add_item(conn, &note_id, &text)).await?;
    let _ = app.emit("notes-changed", changed_payload(&item.note_id, window.label()));
    Ok(item)
}

#[tauri::command]
async fn update_todo_item(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, Db>,
    id: String,
    text: Option<String>,
    checked: Option<bool>,
) -> CmdResult<TodoItem> {
    let item = with_conn(state.0.clone(), move |conn| db::update_item(conn, &id, text.as_deref(), checked)).await?;
    let _ = app.emit("notes-changed", changed_payload(&item.note_id, window.label()));
    Ok(item)
}

#[tauri::command]
async fn delete_todo_item(app: AppHandle, window: tauri::Window, state: State<'_, Db>, id: String) -> CmdResult<()> {
    let note_id = with_conn(state.0.clone(), move |conn| db::delete_item(conn, &id)).await?;
    let _ = app.emit("notes-changed", changed_payload(&note_id, window.label()));
    Ok(())
}

/// 设置/清除待办项提醒(remindAt 为 null 表示清除);完成后由 update_todo_item 自动取消
#[tauri::command]
async fn set_todo_reminder(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, Db>,
    id: String,
    remind_at: Option<i64>,
) -> CmdResult<TodoItem> {
    let item = with_conn(state.0.clone(), move |conn| db::set_reminder(conn, &id, remind_at)).await?;
    // 唤醒调度线程重扫:全库仅此路径能创建未来提醒,否则近刻提醒要等当前休眠结束才被发现
    if item.remind_at.is_some() {
        crate::reminder::wake();
    }
    let _ = app.emit("notes-changed", changed_payload(&item.note_id, window.label()));
    Ok(item)
}

#[cfg(desktop)]
fn reveal_and_focus(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        // 若处于贴边隐藏状态,请求展开
        dock::request_show("main");
    }
}

#[cfg(desktop)]
fn quick_shortcuts() -> [tauri_plugin_global_shortcut::Shortcut; 2] {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    [
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyT),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN),
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // 单实例:重复启动时聚焦已有窗口而不是开新进程
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            reveal_and_focus(app);
        }));
    }

    // 全局快捷键(注册失败不崩溃,仅降级)
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::ShortcutState;
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let [todo_sc, note_sc] = quick_shortcuts();
                    let kind = if shortcut == &todo_sc {
                        "todo"
                    } else if shortcut == &note_sc {
                        "note"
                    } else {
                        return;
                    };
                    reveal_and_focus(app);
                    let _ = app.emit("quick-add", kind);
                })
                .build(),
        );
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let db_path = data_dir.join("notepad.db");
            let conn = db::init(&db_path).map_err(std::io::Error::other)?;
            app.manage(Db(Arc::new(Mutex::new(conn))));

            // 应用语言:按系统语言初始化。必须先于 reminder::spawn:
            // 调度线程首拍"启动即补发"就会用 i18n 状态,晚注册会让它 panic
            #[cfg(desktop)]
            let locale = i18n::AppLocale::from_system();
            #[cfg(desktop)]
            app.manage(i18n::AppState(std::sync::Mutex::new(locale)));

            // 待办提醒调度:常驻后台线程扫描到期项并发系统通知
            reminder::spawn(app.handle().clone());
            // 通知身份(AUMID)预注册:后台线程执行,不阻塞启动
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || crate::notify::prewarm(&handle));
            }

            #[cfg(desktop)]
            {
                use tauri::menu::{Menu, MenuItem};
                dock::spawn(app.handle().clone());

                // 快捷键注册:失败(如被其他实例占用)仅提示,不崩溃
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                let gs = app.global_shortcut();
                for sc in quick_shortcuts() {
                    if let Err(e) = gs.register(sc) {
                        eprintln!("全局快捷键注册失败({e}),可能已有另一个实例在运行");
                    }
                }

                let show = MenuItem::with_id(app, "show", locale.tray_show(), true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", locale.tray_quit(), true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
                tauri::tray::TrayIconBuilder::with_id("main-tray")
                    .icon(app.default_window_icon().expect("missing icon").clone())
                    .tooltip(locale.app_title())
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => reveal_and_focus(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    // 左键单击/双击托盘图标 = 显示主窗口
                    .on_tray_icon_event(|tray, event| match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                        | TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        } => {
                            reveal_and_focus(tray.app_handle());
                        }
                        _ => {}
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // 主窗口点关闭 = 隐藏到托盘;独立便签窗口允许真正关闭
            tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            // 独立窗口销毁:注销停靠管理并通知主界面恢复显示该便签
            tauri::WindowEvent::Destroyed if window.label().starts_with("note-") => {
                #[cfg(desktop)]
                dock::unregister(window.label());
                let id = window.label().trim_start_matches("note-");
                let _ = window.app_handle().emit("note-window-closed", id);
            }
            // 提醒弹窗销毁:记录时刻供 open_reminder_popup 识别"关闭回声"
            // (点铃铛引发的失焦自毁,其后的 click 不应重建弹窗)
            tauri::WindowEvent::Destroyed if window.label().starts_with("reminder-pop-") => {
                reminder_popup::record_closed(window.label());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            get_note,
            create_note,
            update_note,
            delete_note,
            add_todo_item,
            update_todo_item,
            delete_todo_item,
            set_todo_reminder,
            detach_note_window,
            register_note_dock,
            set_window_on_top,
            set_app_locale,
            reminder_popup::get_todo_item,
            reminder_popup::open_reminder_popup,
            reminder_popup::close_reminder_popups
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detach_position_anchors_grab_point_under_cursor() {
        // @1x:抓取点 (100, 80) → 窗口左上角 = 光标 − 抓取偏移,捏住的部位原位不动
        let (x, y) = detach_position((500.0, 400.0), (100.0, 80.0), 1.0);
        assert_eq!((x, y), (400.0, 320.0));
    }

    #[test]
    fn detach_position_clamps_grab_into_window() {
        // 卡片比窗口大:捏着超出窗口范围的部位时,按最近等价位置钳制后落位
        let (x, y) = detach_position((500.0, 400.0), (340.0, 360.0), 1.0);
        assert_eq!(
            (x, y),
            (
                500.0 - (NOTE_WINDOW_W - GRAB_MARGIN_X),
                400.0 - (NOTE_WINDOW_H - GRAB_MARGIN_Y)
            )
        );
    }

    #[test]
    fn detach_position_scales_physical_cursor_and_css_grab() {
        // @2x:光标是物理坐标,抓取点是 CSS px(物理偏移 = grab×2),输出为逻辑坐标
        let (x, y) = detach_position((1000.0, 800.0), (100.0, 80.0), 2.0);
        assert_eq!((x, y), ((1000.0 - 200.0) / 2.0, (800.0 - 160.0) / 2.0));
    }

    #[test]
    fn clamp_grab_defaults_stay_inside_window() {
        // 按钮路径的缺省抓取点(中上)必须落在钳制范围内,入场动画原点不越界
        let g = clamp_grab((NOTE_WINDOW_W * 0.5, GRAB_MARGIN_Y + 4.0));
        assert_eq!(g, (NOTE_WINDOW_W * 0.5, GRAB_MARGIN_Y + 4.0));
    }
}
