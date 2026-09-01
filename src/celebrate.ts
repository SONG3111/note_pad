// 全部完成庆祝效果:渲染交给 canvas-confetti(https://github.com/catdad/canvas-confetti),
// 它的粒子物理(重力/阻力/摆动/3D 翻转)比自己手写的更自然。
// 这里只负责:粉彩色板、从顶部撒落到底部的节奏(总时长约 2.5s)、徽章、冷却防连发、音效。
//
// 调参备注(基于源码语义,改动前先看):
// - startVelocity 单位是 px/帧,实际初速 = 0.5~1 × startVelocity,窗口小千万别给大
// - gravity 实际生效值 = 配置值 × 3(px/帧²)
// - shapeFromPath 会把路径归一化到 10×10px 框,形状大小只由 scalar 决定
import confetti from "canvas-confetti";
import "./celebrate.css";
import { playAllDoneSound } from "./sound";

// 纸屑色板: 手账便签纸色系(陶土/黄油/鼠尾草/雾蓝/薰衣草/玫瑰),
// 低饱和保证落在米纸背景上仍然可见, 色相够多避免随机取色时"只剩一种颜色"
const CONFETTI_COLORS = [
  "#bc6b43", "#e9cd8f", "#8fae83", "#c1d3de",
  "#d5c6dd", "#e5c2b8", "#f0dfae", "#a55835",
];

// 长条彩带形状,和方片混搭——都是"纸"的形状,视觉像被撕碎的彩色纸屑
const STRIP_SHAPE = confetti.shapeFromPath({ path: "M0 0 L16 0 L16 5 L0 5 Z" });

// 撒落节奏:每 80ms 撒 3 粒(每粒独立取点),持续 ~1.7s,连续细水长流不扎堆
const BURST_WINDOW_MS = 1700;
const BURST_INTERVAL_MS = 80;
const PER_ROUND = 3;
// 单粒存活 ~3.5s(ticks≈帧数)。注意:该库透明度随寿命线性衰减(alpha=1-tick/ticks),
// 速度与重力都调小让纸屑"缓缓飘落",落出窗口底部时仍有一定不透明度;
// 之后它已在屏外,不会出现"半空淡出"
const PARTICLE_TICKS = 210;
const BADGE_LIFETIME_MS = 2600;
const COOLDOWN_MS = 1500;
let lastPlayedAt = 0;

const CONFETTI_DEFAULTS: confetti.Options = {
  colors: CONFETTI_COLORS,
  shapes: [STRIP_SHAPE, "square"],
  ticks: PARTICLE_TICKS,
  // angle:270 在该库坐标系(angle2D=-radAngle)里才是竖直向下;90 会向上喷
  angle: 270,
  spread: 45,
  startVelocity: 6.5,
  // 实际重力 = 配置 × 3 = 4.2px/帧²,纸屑飘落更慢更轻
  gravity: 1.4,
  decay: 0.92,
  scalar: 1.4,
  zIndex: 9999,
  disableForReducedMotion: true,
};

// 黄金比例散列取横向位置:相邻两次取点天然错开,比 Math.random 更均匀,
// 不会出现几个点落在同一处的"一团一团"
// 颜色按序号轮转:库内取色是 colors[序号 % particleCount 范围],particleCount=1 时
// 永远只会取 colors[0],必须在调用方自己轮转色板,否则全场只有一种颜色
let sprinkleSeq = 0;
function sprinkle() {
  for (let i = 0; i < PER_ROUND; i++) {
    const seq = sprinkleSeq++;
    const x = (seq * 0.618034) % 1;
    const color = CONFETTI_COLORS[seq % CONFETTI_COLORS.length];
    confetti({
      ...CONFETTI_DEFAULTS,
      colors: [color],
      particleCount: 1,
      origin: { x, y: 0 },
      scalar: 1.1 + Math.random() * 0.6,
    });
  }
}

function showBadge() {
  const badge = document.createElement("div");
  badge.className = "celebrate-badge";
  // 不用 emoji: 一颗手绘风小星星 + 文案, 星星随徽章一起弹簧入场
  badge.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c.9 5.2 2.6 8.4 10 10-7.4 1.6-9.1 4.8-10 10-.9-5.2-2.6-8.4-10-10 7.4-1.6 9.1-4.8 10-10z" fill="#f0dfae" stroke="#bc6b43" stroke-width="1.4" stroke-linejoin="round"/></svg><span>全部完成！</span>';
  badge.setAttribute("aria-hidden", "true");
  document.body.appendChild(badge);
  window.setTimeout(() => badge.remove(), BADGE_LIFETIME_MS);
}

export function celebrateAllDone() {
  const now = Date.now();
  if (now - lastPlayedAt < COOLDOWN_MS) return;
  lastPlayedAt = now;

  playAllDoneSound();
  // 减弱动效偏好:只保留声音,不出视觉动画
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  showBadge();

  const end = Date.now() + BURST_WINDOW_MS;
  const frame = () => {
    sprinkle();
    if (Date.now() < end) window.setTimeout(frame, BURST_INTERVAL_MS);
  };
  frame();
}
