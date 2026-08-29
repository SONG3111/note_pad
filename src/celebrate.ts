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

// 彩带色板:9 个色相(粉/珊瑚/橙/黄/绿/青/蓝/靛/紫),饱和度适中保证白底可见,
// 色相够多避免随机取色时视觉上"只剩一种颜色"
const CONFETTI_COLORS = [
  "#f472b6", "#fb7185", "#fb923c", "#fbbf24",
  "#4ade80", "#2dd4bf", "#60a5fa", "#818cf8", "#a78bfa",
];

// 长条彩带形状,和方片/圆片混搭,视觉更像真实彩带
const STRIP_SHAPE = confetti.shapeFromPath({ path: "M0 0 L16 0 L16 5 L0 5 Z" });

// 撒落节奏:每 80ms 撒 3 粒(每粒独立取点),持续 ~1.7s,共 ~64 粒,连续细水长流不扎堆
const BURST_WINDOW_MS = 1700;
const BURST_INTERVAL_MS = 80;
const PER_ROUND = 3;
// 单粒存活 ~2.3s(ticks≈帧数)。注意:该库透明度随寿命线性衰减(alpha=1-tick/ticks),
// 所以让粒子在 ~1.5s(寿命前 60%)就落出窗口底部,落底时仍有约 40% 不透明度;
// 之后它已在屏外,不会出现"半空淡出"
const PARTICLE_TICKS = 140;
const BADGE_LIFETIME_MS = 2600;
const COOLDOWN_MS = 1500;
let lastPlayedAt = 0;

const CONFETTI_DEFAULTS: confetti.Options = {
  colors: CONFETTI_COLORS,
  shapes: [STRIP_SHAPE, "square", "circle"],
  ticks: PARTICLE_TICKS,
  // angle:270 在该库坐标系(angle2D=-radAngle)里才是竖直向下;90 会向上喷
  angle: 270,
  spread: 35,
  startVelocity: 9,
  // 实际重力 = 配置 × 3 = 7.5px/帧²,720px 窗口约 1.5s 贯穿落底
  gravity: 2.5,
  decay: 0.9,
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
  badge.textContent = "全部完成! 🎉";
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
