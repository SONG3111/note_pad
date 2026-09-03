// 应用内语言(Rust 侧):与前端 vue-i18n 的 locale 对齐(见 src/i18n/index.ts)。
// 托盘菜单、tooltip、拖出便签窗口的标题都在 Rust 侧创建,按此 locale 本地化。

use std::sync::Mutex;

use tauri::{AppHandle, Manager};

/// 支持的语言,与前端 locale 标签("zh-CN"/"en-US")双向对应
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AppLocale {
    Zh,
    En,
}

impl AppLocale {
    /// 从 BCP-47 语言标签解析(容忍地区后缀):zh 开头 → 中文,其余 → 英文
    pub fn from_tag(tag: &str) -> Self {
        if tag.to_ascii_lowercase().starts_with("zh") {
            Self::Zh
        } else {
            Self::En
        }
    }

    /// 系统语言 → 应用语言;解析失败回退中文
    pub fn from_system() -> Self {
        match sys_locale::get_locale() {
            Some(tag) => Self::from_tag(&tag),
            None => Self::Zh,
        }
    }

    pub fn app_title(self) -> &'static str {
        match self {
            Self::Zh => "灵感便签",
            Self::En => "Inkling Notes",
        }
    }

    pub fn tray_show(self) -> &'static str {
        match self {
            Self::Zh => "显示主窗口",
            Self::En => "Show main window",
        }
    }

    pub fn tray_quit(self) -> &'static str {
        match self {
            Self::Zh => "退出灵感便签",
            Self::En => "Quit Inkling Notes",
        }
    }
}

/// 全局语言状态:setup 时按系统语言初始化,前端切换语言时经 set_app_locale 命令写入
pub struct AppState(pub Mutex<AppLocale>);

impl AppState {
    pub fn current(&self) -> AppLocale {
        self.0.lock().map(|l| *l).unwrap_or(AppLocale::Zh)
    }
}

/// 读取当前语言(命令与窗口创建处使用)
pub fn current(app: &AppHandle) -> AppLocale {
    app.state::<AppState>().current()
}

/// 按指定语言重建托盘菜单与 tooltip。
/// 菜单事件/点击处理器挂在 TrayIcon 上,替换菜单后仍然生效。
#[cfg(desktop)]
pub fn rebuild_tray(app: &AppHandle, locale: AppLocale) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};

    let Some(tray) = app.tray_by_id("main-tray") else {
        return Ok(());
    };
    let show = MenuItem::with_id(app, "show", locale.tray_show(), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", locale.tray_quit(), true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    tray.set_menu(Some(menu))?;
    tray.set_tooltip(Some(locale.app_title()))?;
    Ok(())
}
