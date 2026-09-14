<script setup lang="ts">
// 待办提醒选择器:铃铛按钮 + 弹出小面板(自绘月历 + 时/分纸片选择器)。
// 刻意不用原生日期/时间控件:其显示格式与弹层跟随 WebView 系统语言
// (Chromium 不支持 lang 属性,issues.chromium.org/40326106),中文系统开英文界面会漏出中文。
// 自绘部分全部经 vue-i18n/Intl 按应用语言渲染。选择即生效,面板外点击关闭。
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { dateKey } from "../types";
import CalendarGrid from "./CalendarGrid.vue";
import TimeSelect from "./TimeSelect.vue";

const props = defineProps<{ remindAt: number | null; disabled?: boolean }>();

const emit = defineEmits<{
  set: [remindAt: number | null];
}>();

const { t } = useI18n();
const rootRef = ref<HTMLElement | null>(null);
const btnRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const open = ref(false);
// 打开瞬间快照的定位与日历视图,面板存活期间保持稳定
const panelStyle = ref<{ top: string; right: string }>({ top: "0px", right: "0px" });
const initialKey = ref<string | null>(null);
// 早于今天的日子禁选(提醒必须指向未来)
const minKey = ref<string | null>(null);

// 面板内的选择状态:打开瞬间从当前提醒(未设则现在 +1 小时)初始化
const dayKey = ref<string | null>(null);
const hour = ref(0);
const minute = ref(0);

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
  if (open.value) {
    open.value = false;
    return;
  }
  const rect = btnRef.value?.getBoundingClientRect();
  if (rect) placePanel(rect, PANEL_H);
  const base = props.remindAt ?? Date.now() + 3_600_000;
  const d = new Date(base);
  dayKey.value = dateKey(base);
  hour.value = d.getHours();
  minute.value = d.getMinutes();
  minKey.value = dateKey(Date.now());
  initialKey.value = dayKey.value;
  open.value = true;
  // 弹开后按实测高度校正:估算常量与真实高度(尤其向上弹时)的差值会变成与铃铛的空隙
  await nextTick();
  const measured = panelRef.value?.offsetHeight;
  if (rect && measured) placePanel(rect, measured);
}

// 日期或时分任一变化即提交(不关面板,便于继续微调);铃铛旁的时间标签实时跟随
function commit() {
  if (!dayKey.value) return;
  const [y, m, d] = dayKey.value.split("-").map(Number);
  let ts = new Date(y, m - 1, d, hour.value, minute.value).getTime();
  // 仅当所选分钟已整分钟过去(真正错过)才钳到 1 分钟后,库里不留过去时间戳;
  // 当前分钟内的选择保留精确时刻(到点即触发):否则连续给多项设同一时刻时,
  // 晚提交的一项会被静默 +60 秒,与其他项错开约一分钟;
  // 钳制结果回写面板,避免下拉框显示与已生效的提醒时间不一致
  if (ts < new Date().setSeconds(0, 0)) {
    ts = Date.now() + 60_000;
    const clamped = new Date(ts);
    dayKey.value = dateKey(ts);
    hour.value = clamped.getHours();
    minute.value = clamped.getMinutes();
  }
  emit("set", ts);
}

function clearReminder() {
  emit("set", null);
  open.value = false;
}

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

    <div v-if="open" ref="panelRef" class="rp-panel" :style="panelStyle">
      <div class="rp-head">
        <p class="rp-label">{{ t("reminder.customTime") }}</p>
        <!-- 文字按钮放标题行右端:行高由标题决定,出现/消失不改变面板高度,
             避免"设了提醒面板变高"把矮窗口的内容顶出截断 -->
        <button v-if="remindAt !== null" class="rp-clear" @click="clearReminder">
          {{ t("reminder.clear") }}
        </button>
      </div>
      <CalendarGrid
        v-model="dayKey"
        :initial-key="initialKey"
        :min-key="minKey"
        compact
        @update:model-value="commit"
      />
      <div class="rp-time-row">
        <TimeSelect
          v-model="hour"
          :max="23"
          :aria-label="t('reminder.hour')"
          @update:model-value="commit"
        />
        <span class="rp-colon">:</span>
        <TimeSelect
          v-model="minute"
          :max="59"
          :aria-label="t('reminder.minute')"
          @update:model-value="commit"
        />
      </div>
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

/* 弹出面板 = 一张小纸条(fixed 定位,坐标在打开瞬间按铃铛位置计算) */
.rp-panel {
  position: fixed;
  z-index: 200;
  width: 240px;
  padding: 12px 12px 10px;
  background-color: var(--surface);
  background-image: var(--grain);
  border: 1px solid var(--border-strong);
  border-radius: 11px 14px 12px 15px / 14px 11px 15px 12px;
  box-shadow: var(--shadow-l);
  animation: rp-pop 0.16s var(--ease-out);
}
@keyframes rp-pop {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
/* 头部:标题居左,清除按钮(✕)居右上角 */
.rp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 6px;
}
.rp-label {
  margin: 0;
  font-family: var(--font-hand);
  font-size: 12.5px;
  color: var(--text-muted);
}
/* 清除提醒:标题行右端的小幽灵文字按钮,悬停转危险色 */
.rp-clear {
  flex: none;
  border: none;
  background: transparent;
  color: var(--text-faint);
  border-radius: var(--radius-s);
  padding: 2px 6px;
  font-family: var(--font-hand);
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color 0.15s var(--ease-out),
    background-color 0.15s var(--ease-out),
    transform 0.12s var(--ease-out);
}
.rp-clear:hover {
  color: var(--danger);
  background: var(--danger-soft);
}
.rp-clear:active {
  transform: scale(0.94);
}
/* 时/分下拉:纯数字选项,语言无关 */
.rp-time-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
}
.rp-colon {
  color: var(--text-faint);
  font-size: 12.5px;
}
</style>
