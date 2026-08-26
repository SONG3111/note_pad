//! 多窗口停靠管理器。
//!
//! - 主窗口(main):仅支持左/右贴边
//! - 便签独立窗口(note-*):支持上/下/左/右四向贴边
//!
//! 流程:拖近屏幕边缘停留片刻 → 吸附并滑出屏外留 6px 露出条;
//! 光标靠近露出条弹出,离开收回;托盘/快捷键可强制唤出;
//! 停靠期间窗口置顶(不抢焦点),解除停靠时还原。

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Edge {
    Left,
    Right,
    Top,
    Bottom,
}

const SNAP_DIST: f64 = 32.0;
const STABLE_MS: u128 = 280;
const STRIP: f64 = 6.0;
const EDGE_TRIGGER: f64 = 8.0;
const ZONE_TOLERANCE: f64 = 40.0;
const LEAVE_MARGIN: f64 = 16.0;
const UNDOCK_DIST: f64 = 70.0;
const LERP_K: f64 = 0.42;

type Rect = (f64, f64, f64, f64); // (left, top, right, bottom)

#[derive(Clone)]
struct WinState {
    edge: Option<Edge>,
    mon: Option<Rect>,
    pending: Option<Edge>,
    pending_since: Instant,
    want_show: bool,
    force_until_hover: bool,
    last_set: Option<(i32, i32)>,
    ext_ticks: u32,
}

impl Default for WinState {
    fn default() -> Self {
        Self {
            edge: None,
            mon: None,
            pending: None,
            pending_since: Instant::now(),
            want_show: false,
            force_until_hover: false,
            last_set: None,
            ext_ticks: 0,
        }
    }
}

fn registry() -> &'static Mutex<HashMap<String, WinState>> {
    static REG: OnceLock<Mutex<HashMap<String, WinState>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

fn force_set() -> &'static Mutex<HashSet<String>> {
    static SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

/// 注册参与停靠管理的窗口。主窗口启动时注册;便签独立窗口创建时注册。
pub fn register(label: String) {
    registry().lock().unwrap().insert(label, WinState::default());
}

pub fn unregister(label: &str) {
    registry().lock().unwrap().remove(label);
    force_set().lock().unwrap().remove(label);
}

/// 外部请求某窗口强制展开(托盘/快捷键唤出)
pub fn request_show(label: &str) {
    force_set()
        .lock()
        .unwrap()
        .insert(label.to_string());
}

pub fn spawn(app: AppHandle) {
    register("main".to_string());
    std::thread::spawn(move || loop {
        let nap = tick_all(&app).unwrap_or(Duration::from_millis(300));
        std::thread::sleep(nap);
    });
}

fn ms(v: u64) -> Duration {
    Duration::from_millis(v)
}

fn tick_all(app: &AppHandle) -> tauri::Result<Duration> {
    let labels: Vec<String> = registry().lock().unwrap().keys().cloned().collect();
    let mut min_nap = ms(400);
    for label in labels {
        // 窗口可能已关闭,懒清理
        if app.get_webview_window(&label).is_none() {
            unregister(&label);
            continue;
        }
        // 只窥探不移除:等 tick_docked 真正消费时才清除,
        // 避免窗口隐藏/最小化期间早退导致唤出请求丢失
        let forced = force_set().lock().unwrap().contains(&label);
        // 关键:Tauri 的窗口查询在 Windows 上是同步跨线程往返(发消息给主线程并阻塞等回复)。
        // 若持着 registry 锁做这些阻塞调用,一旦主线程此时需要同一把锁(如窗口销毁时注销),
        // 两线程互相等待 → 整个应用卡死。因此先取状态快照并立即释放锁,
        // 阻塞查询全部在无锁状态下进行,完成后再写回
        let mut snapshot = {
            let st = registry().lock().unwrap();
            match st.get(&label) {
                Some(s) => s.clone(),
                None => continue,
            }
        };
        // 单个窗口查询出错(如窗口正在销毁)只降级该窗口,不中断整轮循环,
        // 否则排在后面的窗口本轮全部失去停靠管理,可能表现为功能静默失效
        let nap = match tick_window(app, &label, &mut snapshot, forced) {
            Ok(nap) => nap,
            Err(_) => ms(300),
        };
        // 写回快照:若窗口在查询期间被注销则直接丢弃,不复活已移除的状态
        {
            let mut st = registry().lock().unwrap();
            if st.contains_key(&label) {
                st.insert(label.clone(), snapshot);
            }
        }
        if nap < min_nap {
            min_nap = nap;
        }
    }
    Ok(min_nap)
}

fn allowed_edges(label: &str) -> &'static [Edge] {
    if label == "main" {
        &[Edge::Left, Edge::Right]
    } else {
        &[Edge::Left, Edge::Right, Edge::Top, Edge::Bottom]
    }
}

fn tick_window(app: &AppHandle, label: &str, st: &mut WinState, forced: bool) -> tauri::Result<Duration> {
    let Some(win) = app.get_webview_window(label) else {
        return Ok(ms(500));
    };
    if !win.is_visible()? || win.is_minimized()? {
        return Ok(ms(400));
    }

    match st.edge {
        None => {
            // 浮动状态下消费掉强制唤出请求,防止陈旧标记导致下次贴边停靠后意外展开
            if forced {
                force_set().lock().unwrap().remove(label);
            }
            tick_floating(&win, st, label)
        }
        Some(edge) => tick_docked(app, &win, label, st, edge, forced),
    }
}

fn tick_floating(win: &WebviewWindow, st: &mut WinState, label: &str) -> tauri::Result<Duration> {
    if win.is_maximized()? || win.is_fullscreen()? {
        return Ok(ms(200));
    }
    let Some(mon) = win.current_monitor()? else {
        return Ok(ms(300));
    };
    let mp = mon.position();
    let msize = mon.size();
    let (mon_l, mon_t) = (mp.x as f64, mp.y as f64);
    let mon_r = mon_l + msize.width as f64;
    let mon_b = mon_t + msize.height as f64;

    let pos = win.outer_position()?;
    let size = win.outer_size()?;
    let px = pos.x as f64;
    let py = pos.y as f64;
    let w = size.width as f64;

    if st.last_set == Some((pos.x, pos.y)) {
        return Ok(ms(200));
    }
    st.last_set = None;

    let dl = px - mon_l;
    let dr = mon_r - (px + w);
    let dt = py - mon_t;
    let db = mon_b - (py + size.height as f64);
    let allowed = allowed_edges(label);

    let cand: Option<Edge> = allowed.iter().copied().min_by_key(|e| match e {
        Edge::Left => dl.abs() as i64,
        Edge::Right => dr.abs() as i64,
        Edge::Top => dt.abs() as i64,
        Edge::Bottom => db.abs() as i64,
    });
    let cand = cand.filter(|e| match e {
        Edge::Left => dl.abs() < SNAP_DIST,
        Edge::Right => dr.abs() < SNAP_DIST,
        Edge::Top => dt.abs() < SNAP_DIST,
        Edge::Bottom => db.abs() < SNAP_DIST,
    });

    match cand {
        Some(e) => match st.pending {
            Some(p) if p == e => {
                if st.pending_since.elapsed().as_millis() >= STABLE_MS {
                    st.mon = Some((mon_l, mon_t, mon_r, mon_b));
                    st.edge = Some(e);
                    st.want_show = false;
                    st.pending = None;
                    let _ = win.set_always_on_top(true);
                }
            }
            _ => {
                st.pending = Some(e);
                st.pending_since = Instant::now();
            }
        },
        None => st.pending = None,
    }
    Ok(ms(160))
}

fn targets(edge: Edge, mon: Rect, px: f64, py: f64, w: f64, h: f64, shown: bool) -> (f64, f64) {
    let (mon_l, mon_t, mon_r, mon_b) = mon;
    match edge {
        Edge::Left => (
            if shown { mon_l } else { mon_l - w + STRIP },
            py,
        ),
        Edge::Right => (
            if shown { mon_r - w } else { mon_r - STRIP },
            py,
        ),
        Edge::Top => (
            px,
            if shown { mon_t } else { mon_t - h + STRIP },
        ),
        Edge::Bottom => (
            px,
            if shown { mon_b - h } else { mon_b - STRIP },
        ),
    }
}

fn tick_docked(
    app: &AppHandle,
    win: &WebviewWindow,
    label: &str,
    st: &mut WinState,
    edge: Edge,
    forced: bool,
) -> tauri::Result<Duration> {
    let Some(mon) = st.mon else {
        st.edge = None;
        return Ok(ms(100));
    };

    let pos = win.outer_position()?;
    let size = win.outer_size()?;
    let (px, py) = (pos.x as f64, pos.y as f64);
    let (w, h) = (size.width as f64, size.height as f64);

    let t_hidden = targets(edge, mon, px, py, w, h, false);
    let t_shown = targets(edge, mon, px, py, w, h, true);

    let ours = st.last_set == Some((pos.x, pos.y));
    st.last_set = None;

    if !ours {
        let off_delta =
            ((px - t_hidden.0).abs() + (py - t_hidden.1).abs())
                .min((px - t_shown.0).abs() + (py - t_shown.1).abs());
        st.ext_ticks += 1;
        if off_delta > UNDOCK_DIST {
            undock(st, win)?;
            return Ok(ms(60));
        }
        if st.ext_ticks < 4 {
            return Ok(ms(45));
        }
    } else {
        st.ext_ticks = 0;
    }

    if forced {
        st.want_show = true;
        st.force_until_hover = true;
        // 实际消费,避免重复触发
        force_set().lock().unwrap().remove(label);
    }

    let (cx, cy) = app
        .cursor_position()
        .map(|c| (c.x, c.y))
        .unwrap_or((f64::MIN, f64::MIN));

    let inside = cx >= px - LEAVE_MARGIN
        && cx <= px + w + LEAVE_MARGIN
        && cy >= py - LEAVE_MARGIN
        && cy <= py + h + LEAVE_MARGIN;

    if !st.want_show {
        let (mon_l, mon_t, mon_r, mon_b) = mon;
        let hit = match edge {
            Edge::Left => cx <= mon_l + EDGE_TRIGGER && cy >= py - ZONE_TOLERANCE && cy <= py + h + ZONE_TOLERANCE,
            Edge::Right => cx >= mon_r - EDGE_TRIGGER && cy >= py - ZONE_TOLERANCE && cy <= py + h + ZONE_TOLERANCE,
            Edge::Top => cy <= mon_t + EDGE_TRIGGER && cx >= px - ZONE_TOLERANCE && cx <= px + w + ZONE_TOLERANCE,
            Edge::Bottom => cy >= mon_b - EDGE_TRIGGER && cx >= px - ZONE_TOLERANCE && cx <= px + w + ZONE_TOLERANCE,
        };
        if hit {
            st.want_show = true;
        }
    } else if st.force_until_hover {
        if inside {
            st.force_until_hover = false;
        }
    } else if !inside {
        st.want_show = false;
    }

    let (tx, ty) = if st.want_show { t_shown } else { t_hidden };
    let dx = tx - px;
    let dy = ty - py;

    if dx.abs() < 1.5 && dy.abs() < 1.5 {
        let target = PhysicalPosition::new(tx.round() as i32, ty.round() as i32);
        win.set_position(target)?;
        st.last_set = Some((target.x, target.y));
        return Ok(if st.want_show { ms(90) } else { ms(140) });
    }

    let nx = (px + dx * LERP_K).round() as i32;
    let ny = (py + dy * LERP_K).round() as i32;
    win.set_position(PhysicalPosition::new(nx, ny))?;
    st.last_set = Some((nx, ny));
    // 30ms 而非 16ms:动画依然流畅,但跨线程窗口操作频率近乎减半,
    // 显著降低 Windows 主线程消息泵压力(多窗口时尤其明显)
    Ok(ms(30))
}

fn undock(st: &mut WinState, win: &WebviewWindow) -> tauri::Result<()> {
    st.edge = None;
    st.pending = None;
    st.last_set = None;
    st.ext_ticks = 0;
    st.force_until_hover = false;
    let _ = win.set_always_on_top(false);
    if let Some((mon_l, mon_t, mon_r, mon_b)) = st.mon {
        let pos = win.outer_position()?;
        let size = win.outer_size()?;
        let mut x = pos.x;
        let mut y = pos.y;
        if (x as f64) < mon_l {
            x = mon_l as i32;
        }
        if (x as f64 + size.width as f64) > mon_r {
            x = (mon_r - size.width as f64).round() as i32;
        }
        if (y as f64) < mon_t {
            y = mon_t as i32;
        }
        if (y as f64 + size.height as f64) > mon_b {
            y = (mon_b - size.height as f64).round() as i32;
        }
        win.set_position(PhysicalPosition::new(x, y))?;
    }
    st.mon = None;
    Ok(())
}
