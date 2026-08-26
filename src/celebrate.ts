// 全部完成庆祝效果:顶层固定层(与粒子迸发同架构),不被滚动区/圆角窗口裁剪。
// 仅由"用户勾选补齐最后一项"的调用方触发,冷却防连发。
import "./celebrate.css";
import { playAllDoneSound } from "./sound";

// 飘落小元素:猫爪是产品符号占比最高,混四角星、闪光、星星、小花
const FALL_GLYPHS = [
  "🐾", "✦", "🐾", "✨", "🌸", "🐾", "✧", "⭐", "🐾",
  "✦", "✨", "🐾", "🌸", "✧", "🐾", "⭐", "✦", "🐾",
];
// 覆盖整体淡出(1.25s 开始)+ 淡出时长(0.35s),之后清理节点
const LAYER_LIFETIME = 1600;
const COOLDOWN_MS = 1500;
let lastPlayedAt = 0;

export function celebrateAllDone() {
  const now = Date.now();
  if (now - lastPlayedAt < COOLDOWN_MS) return;
  lastPlayedAt = now;

  playAllDoneSound();
  // 减弱动效偏好:只保留声音,不出视觉动画
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const layer = document.createElement("div");
  layer.className = "celebrate-layer";
  layer.setAttribute("aria-hidden", "true");

  // 猫咪探头(150ms 延迟在 CSS 里)
  const cat = document.createElement("div");
  cat.className = "celebrate-cat";
  cat.textContent = "🐱";
  layer.appendChild(cat);

  // "All done! 🎉" 徽章(300ms 延迟在 CSS 里)
  const badge = document.createElement("div");
  badge.className = "celebrate-badge";
  badge.textContent = "全部完成! 🎉";
  layer.appendChild(badge);

  // 飘落小元素:随机横向位置/字号/时长/出发延迟/漂移/旋转,错峰更自然
  for (let i = 0; i < FALL_GLYPHS.length; i++) {
    const p = document.createElement("span");
    p.className = "celebrate-fall";
    p.textContent = FALL_GLYPHS[i];
    p.style.left = `${Math.random() * 100}%`;
    p.style.fontSize = `${14 + Math.random() * 12}px`;
    p.style.animationDuration = `${0.9 + Math.random() * 0.5}s`;
    p.style.animationDelay = `${0.2 + Math.random() * 0.3}s`;
    p.style.setProperty("--drift", `${Math.round((Math.random() - 0.5) * 60)}px`);
    p.style.setProperty("--spin", `${Math.round((Math.random() - 0.5) * 240)}deg`);
    layer.appendChild(p);
  }

  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), LAYER_LIFETIME);
}
