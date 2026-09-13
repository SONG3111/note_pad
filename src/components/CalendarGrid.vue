<script setup lang="ts">
// 可复用月历网格:周一起始 6x7 补位 + 月份导航,日历筛选(DatePicker)与提醒选择器(ReminderPicker)共用。
// 刻意自研而非用原生日期控件:原生控件的显示格式与日历弹层跟随 WebView 系统语言
// (Chromium 明确不支持 lang 属性,见 issues.chromium.org/40326106),英文界面下会漏出中文;
// 这里的月份标题/星期表头全部经 vue-i18n 与 Intl 按应用语言渲染
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { dateKey } from "../types";

const props = defineProps<{
  /** 选中日期("YYYY-MM-DD" 本地时区键),null = 未选 */
  modelValue: string | null;
  /** 打开面板时视图定位到的月份键(网格随父面板 v-if 每次挂载,只在挂载时读取);缺省为当前月 */
  initialKey?: string | null;
  /** 打点日期集合(如"这天有记录"),可选 */
  markedDates?: Set<string>;
  /** 早于该键的日期禁用(提醒不可设在过去),可选 */
  minKey?: string | null;
  /** 紧凑尺寸(提醒面板较窄) */
  compact?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [key: string] }>();

const { t, tm, locale } = useI18n();

const initial = props.initialKey ? props.initialKey.split("-").map(Number) : null;
const viewYear = ref(initial ? initial[0] : new Date().getFullYear());
const viewMonth = ref(initial ? initial[1] - 1 : new Date().getMonth()); // 0-11

// 星期表头是数组型文案,tm 取原始消息再转字符串
const weekLabels = computed(() => {
  const msgs = tm("calendar.weekDays");
  return Array.isArray(msgs) ? msgs.map((m) => String(m)) : [];
});

// 月标题用 Intl 按当前语言格式化:中文"2026年9月",英文"September 2026"
const monthLabel = computed(() =>
  new Intl.DateTimeFormat(locale.value, { year: "numeric", month: "long" }).format(
    new Date(viewYear.value, viewMonth.value, 1),
  ),
);

const todayKey = dateKey(Date.now());

// 6x7 网格:从本周周一起始,覆盖当月完整的前后补位
const cells = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1);
  // getDay(): 0=周日..6=周六 → 换算成周一起始的偏移
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(viewYear.value, viewMonth.value, 1 - offset);
  const out: Array<{ key: string; day: number; inMonth: boolean; disabled: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = dateKey(d.getTime());
    out.push({
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === viewMonth.value,
      disabled: props.minKey != null && key < props.minKey,
    });
  }
  return out;
});

function prevMonth() {
  const m = new Date(viewYear.value, viewMonth.value - 1, 1);
  viewYear.value = m.getFullYear();
  viewMonth.value = m.getMonth();
}
function nextMonth() {
  const m = new Date(viewYear.value, viewMonth.value + 1, 1);
  viewYear.value = m.getFullYear();
  viewMonth.value = m.getMonth();
}
</script>

<template>
  <div class="cal" :class="{ compact: props.compact }">
    <div class="cal-head">
      <button class="cal-nav" :title="t('calendar.prevMonth')" @click="prevMonth">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <span class="cal-month">{{ monthLabel }}</span>
      <button class="cal-nav" :title="t('calendar.nextMonth')" @click="nextMonth">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    </div>

    <div class="cal-grid">
      <span v-for="w in weekLabels" :key="w" class="cal-week">{{ w }}</span>
      <button
        v-for="c in cells"
        :key="c.key"
        class="cal-day"
        :class="{ out: !c.inMonth, today: c.key === todayKey, selected: c.key === props.modelValue }"
        :disabled="c.disabled"
        @click="emit('update:modelValue', c.key)"
      >
        {{ c.day }}
        <i v-if="props.markedDates?.has(c.key)" class="cal-dot" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.cal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.cal-month {
  font-family: var(--font-hand);
  font-size: 14px;
  font-weight: 400;
  letter-spacing: 0.5px;
  color: var(--text-strong);
}
.cal-nav {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background-color 0.12s var(--ease-out),
    transform 0.12s var(--ease-out);
}
.cal-nav svg {
  width: 13px;
  height: 13px;
}
.cal-nav:hover {
  background: var(--surface-2);
}
.cal-nav:active {
  transform: scale(0.94);
}

.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.cal-week {
  text-align: center;
  font-size: 11px;
  color: var(--text-faint);
  padding: 3px 0;
}
.cal-day {
  position: relative;
  border: none;
  background: transparent;
  height: 30px;
  border-radius: var(--radius-s);
  font-size: 12.5px;
  color: var(--text);
  cursor: pointer;
  transition: background-color 0.12s var(--ease-out);
}
.cal.compact .cal-day {
  height: 26px;
  font-size: 11.5px;
}
.cal-day:hover:not(:disabled) {
  background: var(--surface-2);
}
.cal-day.out {
  color: var(--text-faint);
  opacity: 0.55;
}
.cal-day.today {
  box-shadow: inset 0 0 0 1px var(--border-strong);
}
.cal-day.selected {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.cal-day:disabled {
  color: var(--text-faint);
  opacity: 0.4;
  cursor: default;
}
/* 打点日期:底部小圆点提示"这天有内容" */
.cal-dot {
  position: absolute;
  left: 50%;
  bottom: 3px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--accent);
  transform: translateX(-50%);
}
.cal-day.selected .cal-dot {
  background: #fff;
}
</style>
