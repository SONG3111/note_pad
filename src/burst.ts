// 顶层粒子迸发层:粒子节点直接挂在 body 下、fixed 定位,
// 摆脱任何祖先元素(滚动区、圆角窗口、弹窗遮罩)的 overflow 裁剪。

// 需覆盖动画时长(0.9s)+ 最大错峰延迟(0.07s),之后清理节点
const BURST_LIFETIME = 1200;
const PARTICLE_COUNT = 10;

export function spawnBurst(x: number, y: number) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = document.createElement("span");
  layer.className = "burst-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.style.left = `${x}px`;
  layer.style.top = `${y}px`;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    layer.appendChild(document.createElement("i"));
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), BURST_LIFETIME);
}
