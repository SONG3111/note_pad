// 提醒选择器独立弹窗(独立便签窗口专用):便签窗口只有 360×380 且 Web 内容
// 画不出 OS 窗口边界,日历面板在其中必然被裁剪;改为在铃铛旁弹出一个
// 无边框透明小窗,像原生下拉一样可超出便签窗口显示。
// 前端(便签窗口的 ReminderPicker)算好铃铛的屏幕物理坐标后调
// open_reminder_popup;显示器钳制/向上翻转在这里做(显示器信息只在 Rust 侧)。
// 弹窗窗口内跑 ReminderPopupApp(按 label 前缀路由,见 main.ts),
// 选择直接走 set_todo_reminder,复用既有的 notes-changed 跨窗口同步。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, LogicalPosition, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::db::{self, Db, TodoItem};
use crate::{with_conn, CmdResult};

/// 弹窗逻辑尺寸(CSS px):面板宽 240 + 两侧 12 阴影边距;高度按面板实测上浮
const POP_W: f64 = 264.0;
const POP_H: f64 = 352.0;
/// 与显示器边缘的最小间隙(逻辑 px)
const SCREEN_MARGIN: f64 = 8.0;
/// 弹窗与铃铛的间距(逻辑 px),与主窗口浮层的 GAP 一致
const GAP: f64 = 6.0;

pub fn popup_label(item_id: &str) -> String {
    format!("reminder-pop-{item_id}")
}

/// 视为"关闭回声"的宽限窗:弹窗销毁后该时间内到来的再次建窗请求被忽略
const REOPEN_GRACE: Duration = Duration::from_millis(400);

fn last_closed() -> &'static Mutex<HashMap<String, Instant>> {
    static REG: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 弹窗销毁时记录时刻(窗口 Destroyed 事件调用),供关闭回声判定
pub fn record_closed(label: &str) {
    if let Ok(mut reg) = last_closed().lock() {
        reg.insert(label.to_string(), Instant::now());
    }
}

/// 该弹窗是否在宽限窗内刚被销毁。纯函数便于单测。
/// 按下铃铛的瞬间焦点交还便签窗口,开着的弹窗失焦自毁;紧随其后的 click 才把
/// 建窗请求送到后端,此时弹窗已不在,前端无从得知按下瞬间它是否开着——
/// 唯一稳定的判据就是时间:刚销毁即说明本次点击开始时弹窗还开着,
/// 语义是"关闭",若照常重建,弹窗就永远点不掉(关了又被这次点击重开)
fn is_reopen_echo(last: Option<Instant>, now: Instant) -> bool {
    matches!(last, Some(t) if now.duration_since(t) < REOPEN_GRACE)
}

fn recently_closed(label: &str) -> bool {
    let now = Instant::now();
    last_closed()
        .lock()
        .ok()
        .map(|reg| is_reopen_echo(reg.get(label).copied(), now))
        .unwrap_or(false)
}

/// 弹窗定位(纯函数,便于单测):优先在锚点下方弹出,放不下向上翻,
/// 水平以锚点为中心、钳制在显示器内。返回建窗用的逻辑坐标。
/// anchor = (铃铛中心 x, 铃铛下缘 y);monitor = (左, 上, 右, 下, 缩放),均物理像素
fn popup_position(anchor: (i32, i32), monitor: (i32, i32, i32, i32, f64)) -> (f64, f64) {
    let (ax, ay) = anchor;
    let (ml, mt, mr, mb, scale) = monitor;
    let to_phys = |v: f64| v * scale; // 逻辑→物理
    let (w, h) = (to_phys(POP_W), to_phys(POP_H));

    // 水平:面板中心对齐铃铛中心,钳制在显示器内
    let x = (ax as f64 - w / 2.0)
        .clamp(ml as f64 + to_phys(SCREEN_MARGIN), mr as f64 - w - to_phys(SCREEN_MARGIN));

    // 垂直:下方放得下(留边距)就向下弹,否则向上翻;两头都放不下时贴着上边距
    let gap = to_phys(GAP);
    let y = if ay as f64 + gap + h <= mb as f64 - to_phys(SCREEN_MARGIN) {
        ay as f64 + gap
    } else {
        (ay as f64 - gap - h).max(mt as f64 + to_phys(SCREEN_MARGIN))
    };

    (x / scale, y / scale) // 物理→逻辑
}

/// 显示器矩形是否包含点(物理像素)
fn monitor_contains(m: &tauri::Monitor, x: i32, y: i32) -> bool {
    let p = m.position();
    let s = m.size();
    x >= p.x && x < p.x + s.width as i32 && y >= p.y && y < p.y + s.height as i32
}

/// 锚点所在显示器;多显示器拖动瞬间锚点可能暂落在显示区外,退回主显示器
fn anchor_monitor(app: &AppHandle, ax: i32, ay: i32) -> Option<(i32, i32, i32, i32, f64)> {
    let mon = app
        .available_monitors()
        .ok()?
        .iter()
        .find(|m| monitor_contains(m, ax, ay))
        .cloned()
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let p = mon.position();
    let s = mon.size();
    Some((p.x, p.y, p.x + s.width as i32, p.y + s.height as i32, mon.scale_factor()))
}

/// 在锚点旁打开(或重定位并聚焦已有的)提醒选择弹窗
#[tauri::command]
pub async fn open_reminder_popup(
    app: AppHandle,
    state: State<'_, Db>,
    item_id: String,
    anchor_x: i32,
    anchor_y: i32,
) -> CmdResult<()> {
    // 项必须存在且未勾选:已勾选项后端本就拒绝设提醒,弹窗无意义
    let item = with_conn(state.0.clone(), move |conn| db::get_item(conn, &item_id)).await?;
    if item.checked {
        return Err("ITEM_CHECKED".into());
    }

    let Some(mon) = anchor_monitor(&app, anchor_x, anchor_y) else {
        return Err("MONITOR_NOT_FOUND".into());
    };
    let (x, y) = popup_position((anchor_x, anchor_y), mon);

    let label = popup_label(&item.id);
    if recently_closed(&label) {
        // 关闭回声:弹窗在本次按压开始时还开着,click 的语义是"关闭"而非"重开"
        return Ok(());
    }
    if let Some(existing) = app.get_webview_window(&label) {
        // 同一项的弹窗已开(销毁在途等罕见交错):重定位到最新锚点并聚焦
        let _ = existing.set_position(LogicalPosition::new(x, y));
        let _ = existing.set_focus();
        return Ok(());
    }

    // label 不以 note- 开头:避免误触 lib.rs Destroyed 处理器里的便签窗口清理;
    // 不注册 dock:弹窗不参与贴边停靠管理
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("")
        .inner_size(POP_W, POP_H)
        .position(x, y)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 关闭所有提醒弹窗(便签窗口被拖动/卸载时调用;无弹窗时是廉价空扫)
#[tauri::command]
pub async fn close_reminder_popups(app: AppHandle) -> CmdResult<()> {
    for (label, win) in app.webview_windows() {
        if label.starts_with("reminder-pop-") {
            let _ = win.destroy();
        }
    }
    Ok(())
}

/// 按 id 取单个待办项(弹窗初始化用);ITEM_NOT_FOUND 时前端弹窗自关
#[tauri::command]
pub async fn get_todo_item(state: State<'_, Db>, id: String) -> CmdResult<TodoItem> {
    with_conn(state.0.clone(), move |conn| db::get_item(conn, &id)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1920×1080 @1x 显示器
    const MON1: (i32, i32, i32, i32, f64) = (0, 0, 1920, 1080, 1.0);
    /// 2560×1440 @2x 显示器
    const MON2: (i32, i32, i32, i32, f64) = (1920, 0, 4448, 1440, 2.0);

    #[test]
    fn reopen_echo_within_grace_only() {
        let now = Instant::now();
        // 从未开过/已遗忘:正常建窗
        assert!(!is_reopen_echo(None, now));
        // 刚销毁(真实点击的 mousedown→click 间隔):判定为关闭回声
        assert!(is_reopen_echo(Some(now), now));
        assert!(is_reopen_echo(Some(now - REOPEN_GRACE + Duration::from_millis(50)), now));
        // 宽限窗外:正常建窗(用户真切想重新打开)
        assert!(!is_reopen_echo(Some(now - REOPEN_GRACE - Duration::from_millis(50)), now));
    }

    #[test]
    fn below_anchor_when_space_fits() {
        // 铃铛在屏幕中上部:向下弹,面板中心对齐铃铛中心
        let (x, y) = popup_position((500, 100), MON1);
        assert_eq!((x, y), (500.0 - POP_W / 2.0, 100.0 + GAP));
    }

    #[test]
    fn flips_up_when_no_space_below() {
        // 铃铛贴近屏幕底:向上翻,面板底缘 = 锚点 - GAP
        let (x, y) = popup_position((500, 1050), MON1);
        assert_eq!((x, y), (500.0 - POP_W / 2.0, 1050.0 - GAP - POP_H));
    }

    #[test]
    fn clamps_to_top_margin_when_neither_fits() {
        // 显示器高度小于面板高度(极端缩放):贴着上边距,不出屏
        let tiny = (0, 0, 1920, 300, 1.0);
        let (_, y) = popup_position((500, 280), tiny);
        assert_eq!(y, SCREEN_MARGIN);
    }

    #[test]
    fn clamps_horizontally_into_monitor() {
        // 铃铛贴近左/右缘:钳制后面板完整落在显示器内
        let (xl, _) = popup_position((10, 100), MON1);
        assert_eq!(xl, SCREEN_MARGIN);
        let (xr, _) = popup_position((1910, 100), MON1);
        assert_eq!(xr, 1920.0 - POP_W - SCREEN_MARGIN);
    }

    #[test]
    fn scales_physical_anchor_to_logical_position() {
        // @2x 显示器:物理锚点(逻辑 1360,100)换算成逻辑建窗坐标,几何关系保持
        let (x, y) = popup_position((1920 + 800, 200), MON2);
        // 面板中心 = 锚点中心:锚点逻辑 x 1360 - 面板半宽
        assert_eq!(x, 1360.0 - POP_W / 2.0);
        // 下方放得下:锚点逻辑 y 100 + GAP
        assert_eq!(y, 100.0 + GAP);
    }

    #[test]
    fn popup_label_matches_routing_prefix() {
        // main.ts 按 reminder-pop- 前缀路由到 ReminderPopupApp,label 格式不能漂移
        assert_eq!(popup_label("abc"), "reminder-pop-abc");
    }
}
