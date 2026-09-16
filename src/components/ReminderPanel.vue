<script setup lang="ts">
// 提醒选择面板本体:自绘月历 + 时/分纸片选择器 + 时间钳制提交逻辑。
// 从 ReminderPicker 抽出的共用组件,两个宿主:
// - 主窗口:ReminderPicker 的浮层(定位在铃铛旁,窗内渲染);
// - 独立便签窗口:ReminderPopupApp 弹窗小窗的页面内容(可超出便签窗口显示)。
// 刻意不用原生日期/时间控件:其显示格式与弹层跟随 WebView 系统语言
// (Chromium 不支持 lang 属性,issues.chromium.org/40326106),中文系统开英文界面会漏出中文。
// 自绘部分全部经 vue-i18n/Intl 按应用语言渲染。选择即生效,由宿主决定关闭时机。
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { dateKey } from "../types";
import CalendarGrid from "./CalendarGrid.vue";
import TimeSelect from "./TimeSelect.vue";

const props = defineProps<{ remindAt: number | null }>();

const emit = defineEmits<{
  set: [remindAt: number];
  clear: [];
}>();

const { t } = useI18n();

// 打开瞬间快照的日历视图与"今天"下界;宿主每次打开都重新挂载本组件,状态不跨次残留
const base = props.remindAt ?? Date.now() + 3_600_000;
const initialKey = dateKey(base);
const minKey = dateKey(Date.now());

const dayKey = ref<string | null>(initialKey);
const hour = ref(new Date(base).getHours());
const minute = ref(new Date(base).getMinutes());

// 日期或时分任一变化即提交(不关面板,便于继续微调);时间标签实时跟随
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
</script>

<template>
  <div class="rp-panel">
    <div class="rp-head">
      <p class="rp-label">{{ t("reminder.customTime") }}</p>
      <!-- 文字按钮放标题行右端:行高由标题决定,出现/消失不改变面板高度,
           避免"设了提醒面板变高"把矮窗口的内容顶出截断 -->
      <button v-if="props.remindAt !== null" class="rp-clear" @click="emit('clear')">
        {{ t("reminder.clear") }}
      </button>
    </div>
    <CalendarGrid v-model="dayKey" :initial-key="initialKey" :min-key="minKey" compact @update:model-value="commit" />
    <div class="rp-time-row">
      <TimeSelect v-model="hour" :max="23" :aria-label="t('reminder.hour')" @update:model-value="commit" />
      <span class="rp-colon">:</span>
      <TimeSelect v-model="minute" :max="59" :aria-label="t('reminder.minute')" @update:model-value="commit" />
    </div>
  </div>
</template>

<style scoped>
.rp-panel {
  width: 240px;
  padding: 12px 12px 10px;
  background-color: var(--surface);
  background-image: var(--grain);
  border: 1px solid var(--border-strong);
  border-radius: 11px 14px 12px 15px / 14px 11px 15px 12px;
  box-shadow: var(--shadow-l);
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
