<script setup lang="ts">
// 待办提醒选择器的铃铛入口,两种模式:
// - panel(默认,主窗口):点击在铃铛旁弹出窗内浮层(fixed 定位,宿主 ReminderPanel);
// - popup(独立便签窗口):便签窗口只有 360×380 且 Web 画不出窗口边界,浮层必然被
//   裁剪;改为把按钮的屏幕坐标发给后端,弹出一个可超出便签窗口的无边框小窗。
// 刻意不用原生日期/时间控件:其显示格式与弹层跟随 WebView 系统语言
// (Chromium 不支持 lang 属性,issues.chromium.org/40326106)。
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import ReminderPanel from "./ReminderPanel.vue";

const props = withDefaults(
  defineProps<{
    remindAt: number | null;
    disabled?: boolean;
    /** panel = 窗内浮层(主窗口);popup = 独立弹窗小窗(便签窗口) */
    mode?: "panel" | "popup";
    /** popup 模式必填:目标待办项 id(弹窗按它定位与回写) */
    itemId?: string;
  }>(),
  { mode: "panel" },
);

const emit = defineEmits<{
  set: [remindAt: number | null];
}>();

const { t } = useI18n();
const btnRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const open = ref(false);
// 打开瞬间快照的定位,浮层存活期间保持稳定
const panelStyle = ref<{ top: string; right: string }>({ top: "0px", right: "0px" });

// 与铃铛的间距,上下方向一致
const GAP = 6;
// 面板高度估算:仅用于挂载前的一帧初始定位,弹开后以实测 offsetHeight 校正
const PANEL_H = 360;

function placePanel(rect: DOMRect, panelH: number) {
  const right = Math.max(8, Math.min(window.innerWidth - rect.right, window.innerWidth - 248));
  // 下方放不下就向上弹(独立便签窗口较矮),间距与向下弹一致
  const flipUp = rect.bottom + panelH > window.innerHeight && rect.top > panelH;
  panelStyle.value = {
    top: flipUp ? `${Math.max(8, rect.top - panelH - GAP)}px` : `${rect.bottom + GAP}px`,
    right: `${right}px`,
  };
}

async function toggle() {
  if (props.mode === "popup") {
    // 点击语义(开/关)由后端判定:按下铃铛会让弹窗失焦自毁,click 到达时弹窗已不在,
    // 前端无从得知按下瞬间它是否开着;后端按"刚销毁即视为关闭回声"忽略本次建窗
    await openPopupWindow();
    return;
  }
  if (open.value) {
    open.value = false;
    return;
  }
  const rect = btnRef.value?.getBoundingClientRect();
  if (rect) placePanel(rect, PANEL_H);
  open.value = true;
  // 弹开后按实测高度校正:估算常量与真实高度(尤其向上弹时)的差值会变成与铃铛的空隙
  await nextTick();
  const measured = panelRef.value?.offsetHeight;
  if (rect && measured) placePanel(rect, measured);
}

// popup 模式:计算铃铛的屏幕物理坐标交给后端建窗(显示器钳制/向上翻转在 Rust 侧做)
async function openPopupWindow() {
  const itemId = props.itemId;
  const btn = btnRef.value;
  if (!itemId || !btn) return;
  const rect = btn.getBoundingClientRect();
  try {
    const win = getCurrentWindow();
    const [scale, origin] = await Promise.all([win.scaleFactor(), win.innerPosition()]);
    // rect 是内容区 CSS 坐标,锚点必须基于内容区原点换算:Windows 上可缩放的无边框
    // 窗口,外框(outerPosition)可能含不可见缩放边距,innerPosition 才与 rect 同一坐标系
    const anchorX = origin.x + Math.round((rect.left + rect.width / 2) * scale);
    const anchorY = origin.y + Math.round(rect.bottom * scale);
    await invoke("open_reminder_popup", { itemId, anchorX, anchorY });
  } catch {
    // 建窗失败静默降级(不崩溃,用户重试即可)
  }
}

// 便签窗口被拖动时弹窗锚点已失效,立即关闭(拖动期间 onMoved 连续触发,
// 首次调用销毁弹窗后,后续调用是廉价空扫)
let unlistenMoved: UnlistenFn | null = null;
// 注册是异步的:若注销句柄落定前组件已卸载(勾选/删除待办项会即时 v-if 卸载本组件),
// 落定后必须立即注销,否则监听器悬挂——窗口每次移动都白发一次清扫 IPC,且随切换累积
let pickerDisposed = false;
onMounted(() => {
  if (props.mode !== "popup") return;
  getCurrentWindow()
    .onMoved(() => {
      invoke("close_reminder_popups").catch(() => {});
    })
    .then((fn) => {
      if (pickerDisposed) {
        fn();
        return;
      }
      unlistenMoved = fn;
    })
    .catch(() => {});
});
onBeforeUnmount(() => {
  pickerDisposed = true;
  unlistenMoved?.();
});

function onDocMousedown(e: MouseEvent) {
  if (open.value && rootRef.value && !rootRef.value.contains(e.target as Node)) {
    open.value = false;
  }
}
onMounted(() => document.addEventListener("mousedown", onDocMousedown));
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocMousedown));
</script>

<template>
  <div ref="rootRef" class="rp">
    <button
      ref="btnRef"
      class="rp-btn"
      :class="{ active: remindAt !== null }"
      :title="remindAt !== null ? t('reminder.edit') : t('reminder.set')"
      :disabled="disabled"
      @click="toggle"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    </button>

    <!-- panel 模式:fixed 浮层包住共用面板;弹窗小窗由后端另行创建 -->
    <div v-if="open && mode === 'panel'" ref="panelRef" class="rp-floating" :style="panelStyle">
      <ReminderPanel
        :remind-at="remindAt"
        @set="(ts) => emit('set', ts)"
        @clear="
          emit('set', null);
          open = false;
        "
      />
    </div>
  </div>
</template>

<style scoped>
.rp {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
/* 铃铛按钮:未设置时随行淡显(hover 显现),已设置时常显提醒色 */
.rp-btn {
  border: none;
  background: transparent;
  color: var(--text-faint);
  opacity: 0.55;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-s);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  transition:
    opacity 0.15s var(--ease-out),
    color 0.15s var(--ease-out),
    background-color 0.15s var(--ease-out),
    transform 0.12s var(--ease-out);
}
.rp:hover .rp-btn,
.rp-btn.active {
  opacity: 1;
}
.rp-btn.active {
  color: var(--accent);
}
.rp-btn:hover {
  background: var(--accent-soft);
}
.rp-btn:active {
  transform: scale(0.9);
}
.rp-btn:disabled {
  cursor: default;
  opacity: 0.25;
}

/* 浮层 = 定位容器(fixed,坐标在打开瞬间按铃铛位置计算),视觉卡片在 ReminderPanel */
.rp-floating {
  position: fixed;
  z-index: 200;
  animation: rp-pop 0.16s var(--ease-out);
}
@keyframes rp-pop {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
</style>
