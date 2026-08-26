mod db;
#[cfg(desktop)]
mod dock;

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use db::{Db, NoteWithItems, TodoItem};

type CmdResult<T> = Result<T, String>;

fn with_conn<T>(state: &State<Db>, f: impl FnOnce(&rusqlite::Connection) -> CmdResult<T>) -> CmdResult<T> {
    let conn = state.0.lock().map_err(|_| "数据库忙".to_string())?;
    f(&conn)
}

#[tauri::command]
fn list_notes(state: State<Db>) -> CmdResult<Vec<NoteWithItems>> {
    with_conn(&state, |conn| db::list_notes(conn).map_err(|e| e.to_string()))
}

#[tauri::command]
fn get_note(state: State<Db>, id: String) -> CmdResult<NoteWithItems> {
    with_conn(&state, |conn| db::get_note(conn, &id).map_err(|e| e.to_string()))
}

/// 把便签从主界面拖出为独立窗口:drag=true 表示来自拖拽手势(鼠标仍按住,可无缝续拖)
#[tauri::command]
async fn detach_note_window(
    app: AppHandle,
    state: State<'_, Db>,
    id: String,
    drag: Option<bool>,
) -> CmdResult<()> {
    // 确认笔记存在
    with_conn(&state, |conn| db::get_note(conn, &id).map_err(|e| e.to_string()))?;

    let label = format!("note-{id}");
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_focus();
        return Ok(());
    }

    #[cfg(desktop)]
    {
        use tauri::WebviewUrl;
        let cp = app.cursor_position().map_err(|e| e.to_string())?;
        let (w, h) = (360.0_f64, 380.0_f64);
        let x = (cp.x - w * 0.5).max(0.0);
        let y = (cp.y - 24.0).max(0.0);
        let scale = app
            .primary_monitor()
            .map_err(|e| e.to_string())?
            .map(|m| m.scale_factor())
            .unwrap_or(1.0);

        let win = tauri::WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
            .title("note pad")
            .inner_size(w, h)
            .position(x / scale, y / scale)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .build()
            .map_err(|e| e.to_string())?;

        let _ = win.set_focus();
        // 仅当鼠标仍按住时才进入拖动循环;按钮点击路径调用会卡死消息泵!
        if drag.unwrap_or(false) {
            let _ = win.start_dragging();
        }
        dock::register(label);
    }
    Ok(())
}

/// 切换任意窗口的置顶状态
#[tauri::command]
async fn set_window_on_top(app: AppHandle, label: String, top: bool) -> CmdResult<()> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| "窗口不存在".to_string())?;
    win.set_always_on_top(top).map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_note(app: AppHandle, state: State<'_, Db>, input: db::CreateNoteInput) -> CmdResult<NoteWithItems> {
    let note = with_conn(&state, |conn| db::create_note(conn, &input).map_err(|e| e.to_string()))?;
    let _ = app.emit("notes-changed", &note.note.id);
    Ok(note)
}

#[tauri::command]
async fn update_note(app: AppHandle, state: State<'_, Db>, id: String, input: db::UpdateNoteInput) -> CmdResult<NoteWithItems> {
    let note = with_conn(&state, |conn| db::update_note(conn, &id, &input))?;
    let _ = app.emit("notes-changed", &note.note.id);
    Ok(note)
}

#[tauri::command]
async fn delete_note(app: AppHandle, state: State<'_, Db>, id: String) -> CmdResult<()> {
    with_conn(&state, |conn| db::delete_note(conn, &id))?;
    let _ = app.emit("notes-changed", &id);
    Ok(())
}

#[tauri::command]
async fn add_todo_item(app: AppHandle, state: State<'_, Db>, note_id: String, text: String) -> CmdResult<TodoItem> {
    let item = with_conn(&state, |conn| db::add_item(conn, &note_id, &text))?;
    let _ = app.emit("notes-changed", &note_id);
    Ok(item)
}

#[tauri::command]
async fn update_todo_item(
    app: AppHandle,
    state: State<'_, Db>,
    id: String,
    text: Option<String>,
    checked: Option<bool>,
) -> CmdResult<TodoItem> {
    let item = with_conn(&state, |conn| db::update_item(conn, &id, text.as_deref(), checked))?;
    let _ = app.emit("notes-changed", &item.note_id);
    Ok(item)
}

#[tauri::command]
async fn delete_todo_item(app: AppHandle, state: State<'_, Db>, id: String) -> CmdResult<()> {
    with_conn(&state, |conn| db::delete_item(conn, &id))?;
    let _ = app.emit("notes-changed", &id);
    Ok(())
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
                    let kind = if shortcut == &quick_shortcuts()[0] {
                        "todo"
                    } else if shortcut == &quick_shortcuts()[1] {
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
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let db_path = data_dir.join("notepad.db");
            let conn = db::init(&db_path).map_err(std::io::Error::other)?;
            app.manage(Db(Mutex::new(conn)));

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

                let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "退出 note pad", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
                tauri::tray::TrayIconBuilder::with_id("main-tray")
                    .icon(app.default_window_icon().expect("missing icon").clone())
                    .tooltip("note pad")
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
            tauri::WindowEvent::Destroyed => {
                if window.label().starts_with("note-") {
                    #[cfg(desktop)]
                    dock::unregister(window.label());
                    let id = window.label().trim_start_matches("note-");
                    let _ = window.app_handle().emit("note-window-closed", id);
                }
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
            detach_note_window,
            set_window_on_top
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
