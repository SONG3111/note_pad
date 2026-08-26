//! 贴边停靠(仅左/右边缘):窗口拖到屏幕左/右边缘停留片刻后吸附,
//! 随后滑出屏外只留一条 6px 露出条;光标靠近露出条时平滑弹出,离开后收回。
//! 把已显示的停靠窗口拖离边缘(>70px)即解除停靠。

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

/// 外部请求展开(全局快捷键唤出时),下一个 tick 生效
pub static FORCE_SHOW: AtomicBool = AtomicBool::new(false);

pub fn request_show() {
    FORCE_SHOW.store(true, Ordering::Relaxed);
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Edge {
    Left,
    Right,
}

const SNAP_DIST: f64 = 32.0; // 距边缘多少像素内算"贴近"
const STABLE_MS: u128 = 280; // 停留多久后正式吸附
const STRIP: f64 = 6.0; // 隐藏时露出条宽度
const EDGE_TRIGGER: f64 = 8.0; // 光标距屏幕边缘多少像素内触发展开
const ZONE_TOLERANCE: f64 = 40.0; // 触发区竖直方向的余量
const LEAVE_MARGIN: f64 = 16.0; // 窗口外扩多少像素内算"未离开"
const UNDOCK_DIST: f64 = 70.0; // 拖离多少像素解除停靠
const LERP_K: f64 = 0.42; // 每帧朝目标移动的比例(指数缓动)

struct LoopState {
    docked_edge: Option<Edge>,
    mon: Option<(f64, f64, f64, f64)>, // 缓存 (left, top, right, bottom),停靠期间固定
    pending: Option<Edge>,
    pending_since: Instant,
    want_show: bool,
    force_until_hover: bool, // 快捷键/托盘唤出后挂起自动收回,直到光标进入窗口
    last_set: Option<(i32, i32)>, // 我们最后一次写入的位置,用于识别用户拖动
    ext_ticks: u32,               // 连续检测到外部移动的次数
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut st = LoopState {
            docked_edge: None,
            mon: None,
            pending: None,
            pending_since: Instant::now(),
            want_show: false,
            force_until_hover: false,
            last_set: None,
            ext_ticks: 0,
        };
        loop {
            let nap = st.tick(&app).unwrap_or(Duration::from_millis(400));
            std::thread::sleep(nap);
        }
    });
}

fn ms(v: u64) -> Duration {
    Duration::from_millis(v)
}

impl LoopState {
    fn tick(&mut self, app: &AppHandle) -> tauri::Result<Duration> {
        let Some(win) = app.get_webview_window("main") else {
            return Ok(ms(500));
        };
        if !win.is_visible()? || win.is_minimized()? {
            return Ok(ms(400));
        }

        match self.docked_edge {
            None => self.tick_floating(&win),
            Some(edge) => self.tick_docked(app, &win, edge),
        }
    }

    fn tick_floating(&mut self, win: &WebviewWindow) -> tauri::Result<Duration> {
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

        let pos = win.outer_position()?;
        let size = win.outer_size()?;
        let px = pos.x as f64;
        let w = size.width as f64;

        // 忽略我们自己设置的位置
        if self.last_set == Some((pos.x, pos.y)) {
            return Ok(ms(120));
        }
        self.last_set = None;

        let dl = px - mon_l;
        let dr = mon_r - (px + w);
        let cand = if dl.abs() <= dr.abs() && dl.abs() < SNAP_DIST {
            Some(Edge::Left)
        } else if dr.abs() < SNAP_DIST {
            Some(Edge::Right)
        } else {
            None
        };

        match cand {
            Some(e) => match self.pending {
                Some(p) if p == e => {
                    if self.pending_since.elapsed().as_millis() >= STABLE_MS {
                        self.mon = Some((mon_l, mon_t, mon_r, mon_t + msize.height as f64));
                        self.docked_edge = Some(e);
                        self.want_show = false;
                        self.pending = None;
                        // 停靠期间置顶显示(不抢焦点),弹出时不被其他应用遮挡
                        let _ = win.set_always_on_top(true);
                    }
                }
                _ => {
                    self.pending = Some(e);
                    self.pending_since = Instant::now();
                }
            },
            None => self.pending = None,
        }
        Ok(ms(100))
    }

    fn tick_docked(&mut self, app: &AppHandle, win: &WebviewWindow, edge: Edge) -> tauri::Result<Duration> {
        let Some((mon_l, _mon_t, mon_r, _mon_b)) = self.mon else {
            self.docked_edge = None;
            return Ok(ms(100));
        };

        let pos = win.outer_position()?;
        let size = win.outer_size()?;
        let px = pos.x as f64;
        let py = pos.y as f64;
        let w = size.width as f64;
        let h = size.height as f64;

        let tx_hidden = match edge {
            Edge::Left => mon_l - w + STRIP,
            Edge::Right => mon_r - STRIP,
        };
        let tx_shown = match edge {
            Edge::Left => mon_l,
            Edge::Right => mon_r - w,
        };

        // 判断这帧位置是不是我们自己写的;不是则说明用户在拖动
        let ours = self.last_set == Some((pos.x, pos.y));
        self.last_set = None;

        if !ours {
            let off_delta = ((px - tx_hidden).abs()).min((px - tx_shown).abs());
            self.ext_ticks += 1;
            if off_delta > UNDOCK_DIST {
                self.undock(win)?;
                return Ok(ms(60));
            }
            if self.ext_ticks < 4 {
                // 用户正在拖:先不动,观察是否拖离
                return Ok(ms(45));
            }
        } else {
            self.ext_ticks = 0;
        }

        // 快捷键/托盘唤出:强制展开一次,并挂起"光标离开即收回"
        if FORCE_SHOW.swap(false, Ordering::Relaxed) {
            self.want_show = true;
            self.force_until_hover = true;
        }

        // 光标逻辑:靠近露出条 → 展开;离开窗口 → 收回
        let (cx, cy) = app
            .cursor_position()
            .map(|c| (c.x, c.y))
            .unwrap_or((f64::MIN, f64::MIN));

        let inside = cx >= px - LEAVE_MARGIN
            && cx <= px + w + LEAVE_MARGIN
            && cy >= py - LEAVE_MARGIN
            && cy <= py + h + LEAVE_MARGIN;

        if !self.want_show {
            let hit = match edge {
                Edge::Left => cx <= mon_l + EDGE_TRIGGER && cy >= py - ZONE_TOLERANCE && cy <= py + h + ZONE_TOLERANCE,
                Edge::Right => cx >= mon_r - EDGE_TRIGGER && cy >= py - ZONE_TOLERANCE && cy <= py + h + ZONE_TOLERANCE,
            };
            if hit {
                self.want_show = true;
            }
        } else if self.force_until_hover {
            // 唤出展开期间不自动收回,等光标进入窗口一次后恢复常规逻辑
            if inside {
                self.force_until_hover = false;
            }
        } else if !inside {
            self.want_show = false;
        }

        let tx = if self.want_show { tx_shown } else { tx_hidden };
        let dx = tx - px;
        if dx.abs() < 1.5 {
            let target = PhysicalPosition::new(tx.round() as i32, py.round() as i32);
            win.set_position(target)?;
            self.last_set = Some((target.x, target.y));
            return Ok(if self.want_show { ms(90) } else { ms(140) });
        }

        let nx = (px + dx * LERP_K).round() as i32;
        win.set_position(PhysicalPosition::new(nx, py.round() as i32))?;
        self.last_set = Some((nx, py.round() as i32));
        Ok(ms(16)) // 动画中 ~60fps
    }

    fn undock(&mut self, win: &WebviewWindow) -> tauri::Result<()> {
        self.docked_edge = None;
        self.pending = None;
        self.last_set = None;
        self.ext_ticks = 0;
        self.force_until_hover = false;
        let _ = win.set_always_on_top(false);
        // 把窗口拉回屏幕内可见区域
        if let Some((mon_l, mon_t, mon_r, mon_b)) = self.mon {
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
        self.mon = None;
        Ok(())
    }
}
