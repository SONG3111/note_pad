<script setup lang="ts">
import { ref } from "vue";
import { playCheckSound, playUncheckSound } from "../sound";
import { spawnBurst } from "../burst";

defineProps<{ checked: boolean }>();
const emit = defineEmits<{ change: [] }>();

const boxRef = ref<HTMLElement | null>(null);

// 音效与粒子仅由用户亲手点击触发(页面加载、跨窗口同步不会播放)
function onChange(e: Event) {
  emit("change");
  if (!(e.target as HTMLInputElement).checked) {
    // 取消勾选只给一声轻响,不播粒子动画,形成方向对比
    playUncheckSound();
    return;
  }
  playCheckSound();
  // 粒子在顶层 fixed 层按复选盒视口坐标生成:不被滚动区/圆角窗口/弹窗裁剪。
  // 每次勾选都新建节点,快速连续勾选也能各自完整播放,无需重播技巧
  const box = boxRef.value;
  if (box) {
    const r = box.getBoundingClientRect();
    spawnBurst(r.left + r.width / 2, r.top + r.height / 2);
  }
}
</script>

<template>
  <label class="cb-wrap">
    <input class="cb-input" type="checkbox" :checked="checked" @change="onChange" />
    <span ref="boxRef" class="cb-box" aria-hidden="true">
      <svg class="cb-check" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4.5 12.5l5 5L19.5 7" />
      </svg>
    </span>
  </label>
</template>

<style scoped>
.cb-wrap {
  position: relative;
  display: inline-flex;
  flex: none;
  cursor: pointer;
}
.cb-input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.cb-box {
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 2px solid var(--border-strong);
  background: var(--surface);
  display: grid;
  place-items: center;
  transition:
    background-color 0.15s var(--ease-out),
    border-color 0.15s var(--ease-out),
    box-shadow 0.15s var(--ease-out),
    transform 0.1s var(--ease-out);
}
.cb-wrap:hover .cb-box {
  border-color: var(--text-faint);
}
.cb-input:active + .cb-box {
  transform: scale(0.9);
}
.cb-input:focus-visible + .cb-box {
  box-shadow: 0 0 0 3px var(--todo-soft);
}
.cb-check {
  width: 11px;
  height: 11px;
  stroke: #fff;
  stroke-width: 3.2;
  opacity: 0;
  transform: scale(0.25);
  transition:
    opacity 0.15s var(--ease-in-out),
    transform 0.18s var(--ease-in-out);
}
.cb-input:checked + .cb-box {
  background-color: var(--todo);
  border-color: var(--todo);
}
.cb-input:checked + .cb-box .cb-check {
  opacity: 1;
  transform: scale(1);
}

/* 粒子迸发:勾选瞬间十颗彩色粒子从盒子四周迸出并淡出。
   由 burst.ts 在 body 下动态生成(见下方非 scoped 样式块),
   仅用户交互时播放,避免页面加载/外部同步时误播 */
</style>

<!-- 粒子层挂在 body 下、不属于任何组件作用域,样式必须非 scoped -->
<style>
.burst-layer {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
}
.burst-layer i {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  opacity: 0;
  transform: translate(-50%, -50%);
  animation: burst-fly 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes burst-fly {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  60% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.35);
  }
}
/* 十个方向 + 两种粒径,绿系为主、暖色点缀,微错峰更像真实迸溅 */
.burst-layer i:nth-child(1) { --dx: 26px; --dy: -22px; background: #34d399; }
.burst-layer i:nth-child(2) { --dx: -24px; --dy: -20px; background: #10b981; animation-delay: 0.03s; }
.burst-layer i:nth-child(3) { --dx: 30px; --dy: 6px; background: #fbbf24; width: 5px; height: 5px; animation-delay: 0.05s; }
.burst-layer i:nth-child(4) { --dx: -28px; --dy: 8px; background: #059669; animation-delay: 0.02s; }
.burst-layer i:nth-child(5) { --dx: 18px; --dy: 24px; background: #2dd4bf; width: 5px; height: 5px; animation-delay: 0.06s; }
.burst-layer i:nth-child(6) { --dx: -16px; --dy: 26px; background: #f59e0b; animation-delay: 0.04s; }
.burst-layer i:nth-child(7) { --dx: 4px; --dy: -30px; background: #a7f3d0; width: 5px; height: 5px; animation-delay: 0.01s; }
.burst-layer i:nth-child(8) { --dx: -4px; --dy: 30px; background: #fcd34d; width: 5px; height: 5px; animation-delay: 0.07s; }
.burst-layer i:nth-child(9) { --dx: 30px; --dy: -10px; background: #6ee7b7; width: 5px; height: 5px; animation-delay: 0.02s; }
.burst-layer i:nth-child(10) { --dx: -30px; --dy: -6px; background: #fb923c; width: 5px; height: 5px; animation-delay: 0.05s; }
</style>
