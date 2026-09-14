// 系统通知发送的单入口(Windows):解决"通知图标显示为 PowerShell"的问题。
// Windows 要求 toast 的发送方有已注册的 AUMID(通常由开始菜单快捷方式携带):
// - 未打包(dev / NSIS):启动时在开始菜单创建带 System.AppUserModel.ID 属性的
//   快捷方式,以 tauri identifier 作为 AUMID 发送;
// - 商店 MSIX 打包版:进程自带包身份,直接用进程 AUMID(包族名!AppID),跳过快捷方式。
// 之前插件对未打包构建回退到 PowerShell 的 AUMID,图标与名称才会显示成 PowerShell。

use std::sync::OnceLock;

use tauri_winrt_notification::Toast;

#[cfg(windows)]
use {
    std::path::PathBuf,
    windows::core::{HSTRING, Interface, PCWSTR, PWSTR},
    windows::Win32::Foundation::{RPC_E_CHANGED_MODE, WIN32_ERROR},
    windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID,
    windows::Win32::Storage::Packaging::Appx::{GetCurrentApplicationUserModelId, GetCurrentPackageFullName},
    windows::Win32::System::Com::StructuredStorage::PROPVARIANT,
    windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED},
    windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore,
    windows::Win32::UI::Shell::{IShellLinkW, ShellLink},
};

/// 解析成功的 AUMID 缓存:进程生命周期内只解析一次
static AUMID: OnceLock<String> = OnceLock::new();

/// 注册串行化锁:prewarm 线程与提醒扫描线程可能同时首次解析,
/// 并发写同一个 .lnk 文件会互相破坏(锁只在未命中缓存时短暂持有)
#[cfg(windows)]
static REGISTER_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 发送一条提醒通知。内部先确保 AUMID 就绪,失败由调用方回退到插件通知。
pub fn send(app: &tauri::AppHandle, title: &str, body: &str) -> Result<(), String> {
    let aumid = resolved_aumid(app)?;
    Toast::new(aumid.as_str())
        .title(title)
        .text1(body)
        .show()
        .map_err(|e| e.to_string())
}

/// 返回本进程应使用的 AUMID,未解析时(首次)即时注册
fn resolved_aumid(app: &tauri::AppHandle) -> Result<String, String> {
    if let Some(a) = AUMID.get() {
        return Ok(a.clone());
    }
    #[cfg(windows)]
    {
        if has_package_identity() {
            let aumid = current_process_aumid()?;
            let _ = AUMID.set(aumid.clone());
            return Ok(aumid);
        }
        let identifier = app.config().identifier.clone();
        // 注册串行化:prewarm 与提醒线程可能同时到达;锁内双重检查避免重复写 .lnk
        let _guard = REGISTER_LOCK.lock().map_err(|_| "注册锁中毒".to_string())?;
        if let Some(a) = AUMID.get() {
            return Ok(a.clone());
        }
        register_shortcut(app, &identifier)?;
        let _ = AUMID.set(identifier.clone());
        Ok(identifier)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("仅 Windows 需要此路径".into())
    }
}

/// 启动时的预注册入口:失败只记日志,不阻塞启动
pub fn prewarm(app: &tauri::AppHandle) {
    if let Err(e) = resolved_aumid(app) {
        eprintln!("通知 AUMID 注册失败({e}),提醒将回退默认通知");
    }
}

#[cfg(windows)]
fn win32_string_result(check: impl Fn(&mut u32, PWSTR) -> WIN32_ERROR) -> Option<String> {
    let mut len = 0u32;
    // 第一次调用只取所需缓冲区长度(返回 INSUFFICIENT_BUFFER 之外的非 0 也直接判失败)
    let probe = check(&mut len, PWSTR::null());
    if probe != WIN32_ERROR(122) {
        return None;
    }
    let mut buf = vec![0u16; len as usize];
    let err = check(&mut len, PWSTR(buf.as_mut_ptr()));
    if err.is_ok() {
        // Win32 约定写入长度含 null 终止符,必须去掉,否则 AUMID 尾部带 '\0' 永远失配
        Some(String::from_utf16_lossy(&buf[..len.saturating_sub(1) as usize]))
    } else {
        None
    }
}

/// 是否运行在 MSIX/商店包身份下
#[cfg(windows)]
fn has_package_identity() -> bool {
    // 无包身份时返回 APPMODEL_ERROR_NO_PACKAGE,其余错误(缓冲区探测正常)都视为有身份
    win32_string_result(|len, pw| unsafe { GetCurrentPackageFullName(len, Some(pw)) }).is_some()
}

/// 打包版:取进程自身的 AUMID(形如 "包族名!AppID")
#[cfg(windows)]
fn current_process_aumid() -> Result<String, String> {
    win32_string_result(|len, pw| unsafe { GetCurrentApplicationUserModelId(len, Some(pw)) })
        .ok_or_else(|| "获取进程 AUMID 失败".into())
}

/// 未打包版:创建/刷新带 AUMID 属性的开始菜单快捷方式
#[cfg(windows)]
fn register_shortcut(app: &tauri::AppHandle, identifier: &str) -> Result<(), String> {
    // 注意用 std 而非 tauri::utils::platform::current_exe:后者带 \\?\ 前缀,
    // IShellLinkW::SetPath 会以 E_INVALIDARG 拒绝
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let product = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "Inspiration Notes".into());
    let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA 未设置".to_string())?;
    let dir = PathBuf::from(&appdata).join(r"Microsoft\Windows\Start Menu\Programs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let lnk_path = dir.join(format!("{product}.lnk"));

    unsafe {
        // 通知线程自己初始化 COM;已被初始化为 MTA 时(RPC_E_CHANGED_MODE)直接沿用
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_err() && hr != RPC_E_CHANGED_MODE {
            return Err(format!("CoInitializeEx 失败: {hr:?}"));
        }

        let link: IShellLinkW =
            CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|e| format!("CoCreateInstance: {e}"))?;
        let exe_h = HSTRING::from(exe.as_os_str());
        let work_dir = HSTRING::from(exe.parent().unwrap_or(&exe));
        link.SetPath(PCWSTR::from_raw(exe_h.as_ptr()))
            .map_err(|e| format!("SetPath({exe_h:?}): {e}"))?;
        link.SetIconLocation(PCWSTR::from_raw(exe_h.as_ptr()), 0)
            .map_err(|e| format!("SetIconLocation: {e}"))?;
        link.SetWorkingDirectory(PCWSTR::from_raw(work_dir.as_ptr()))
            .map_err(|e| format!("SetWorkingDirectory: {e}"))?;

        // 写入 System.AppUserModel.ID:Windows 依赖它把 AUMID 解析到这张快捷方式
        let store: IPropertyStore = link.cast().map_err(|e| format!("cast IPropertyStore: {e}"))?;
        let pv = PROPVARIANT::from(identifier);
        store
            .SetValue(&PKEY_AppUserModel_ID, &pv)
            .map_err(|e| format!("SetValue: {e}"))?;
        store.Commit().map_err(|e| format!("Commit: {e}"))?;

        let persist: IPersistFile = link.cast().map_err(|e| format!("cast IPersistFile: {e}"))?;
        persist
            .Save(&HSTRING::from(lnk_path.as_os_str()), true)
            .map_err(|e| format!("Save: {e}"))?;
    }
    Ok(())
}
