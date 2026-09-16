<script setup lang="ts">
// 主界面工具栏的日历筛选:月网格选择日期,按记录创建日期过滤列表。
// 自研轻量实现(无第三方依赖),视觉跟随应用主题变量。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useNotesStore } from "../stores/notes";
import { dateKey } from "../types";

const { t, tm, locale } = useI18n();
const store = useNotesStore();
const { dateFilter } = storeToRefs(store);

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
// 当前视图的年月(日历面板独立导航,不直接跟随选中值)
const viewYear = ref(new Date().getFullYear());
const viewMonth = ref(new Date().getMonth()); // 0-11

// 有记录的日期集合(本地时区键),用于格子上打点
const notedDates = computed(() => {
  const set = new Set<string>();
  for (const n of store.notes) set.add(dateKey(n.createdAt));
  return set;
});

const todayKey = dateKey(Date.now());

// 6x7 网格:从本周周一起始,覆盖当月完整的前后补位
const weekLabels = computed(() => {
  const msgs = tm("datePicker.weekDays");
  return Array.isArray(msgs) ? msgs.map((m) => String(m)) : [];
});
const cells = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1);
  // getDay(): 0=周日..6=周六 → 换算成周一起始的偏移
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(viewYear.value, viewMonth.value, 1 - offset);
  const out: Array<{ key: string; day: number; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    out.push({
      key: dateKey(d.getTime()),
      day: d.getDate(),
      inMonth: d.getMonth() === viewMonth.value,
    });
  }
  return out;
});

// 月标题用 Intl 按当前语言格式化:中文"2026年9月",英文"September 2026"
const monthLabel = computed(() =>
  new Intl.DateTimeFormat(locale.value, { year: "numeric", month: "long" }).format(
    new Date(viewYear.value, viewMonth.value, 1),
  ),
);

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

function pick(key: string) {
  store.setDateFilter(key);
  open.value = false;
}

function pickToday() {
  const now = new Date();
  viewYear.value = now.getFullYear();
  viewMonth.value = now.getMonth();
  store.setDateFilter(todayKey);
  open.value = false;
}

function clear() {
  store.setDateFilter(null);
  open.value = false;
}

function toggleOpen() {
  open.value = !open.value;
  // 打开时视图落在选中月份(无选中则当前月),避免用户上翻后失联
  if (open.value) {
    const src = dateFilter.value ? dateFilter.value.split("-").map(Number) : null;
    const now = new Date();
    viewYear.value = src ? src[0] : now.getFullYear();
    viewMonth.value = src ? src[1] - 1 : now.getMonth();
  }
}

// 点击面板外关闭(录音按钮等场景不会冲突,这里只管自己)
function onDocPointerDown(e: PointerEvent) {
  if (open.value && rootRef.value && !rootRef.value.contains(e.target as Node)) {
    open.value = false;
  }
}
onMounted(() => document.addEventListener("pointerdown", onDocPointerDown));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocPointerDown));
</script>

<template>
  <div ref="rootRef" class="datepick" :class="{ active: !!dateFilter }">
    <button
      class="dp-btn"
      :title="dateFilter ? t('datePicker.filterActive', { date: dateFilter }) : t('datePicker.filter')"
      @click="toggleOpen"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
        <path v-if="dateFilter" d="M9 16l2 2 4-4" class="dp-check" />
      </svg>
    </button>

    <!-- 面板锚定在按钮右侧、向左展开:right:0 对齐搜索框右缘,
         400px 窗口内完整可见(旧版 left:0 向右展开会被右缘裁掉) -->
    <div v-if="open" class="dp-panel">
      <div class="dp-head">
        <button class="dp-nav" :title="t('datePicker.prevMonth')" @click="prevMonth">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span class="dp-month">{{ monthLabel }}</span>
        <button class="dp-nav" :title="t('datePicker.nextMonth')" @click="nextMonth">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>

      <div class="dp-grid">
        <span v-for="w in weekLabels" :key="w" class="dp-week">{{ w }}</span>
        <button
          v-for="c in cells"
          :key="c.key"
          class="dp-day"
          :class="{
            out: !c.inMonth,
            today: c.key === todayKey,
            selected: c.key === dateFilter,
          }"
          @click="pick(c.key)"
        >
          {{ c.day }}
          <i v-if="notedDates.has(c.key)" class="dp-dot" />
        </button>
      </div>

      <div class="dp-foot">
        <button class="dp-act" data-testid="dp-today" @click="pickToday">{{ t("datePicker.today") }}</button>
        <button class="dp-act" data-testid="dp-clear" :disabled="!dateFilter" @click="clear">{{ t("datePicker.clearFilter") }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 根节点绝对定位于搜索框内部右端(定位上下文是 App.vue 的 .search-wrap) */
.datepick {
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 5;
}
.dp-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    color 0.15s var(--ease-out),
    background-color 0.15s var(--ease-out),
    transform 0.12s var(--ease-out);
}
.dp-btn svg {
  width: 15px;
  height: 15px;
}
.dp-btn:hover {
  color: var(--text-strong);
  background: var(--surface-2);
}
/* skills/review-animations:可按压元素要有 :active 反馈 */
.dp-btn:active {
  transform: scale(0.94);
}
/* 筛选生效中:绿色高亮,勾标出现在日历图标里 */
.datepick.active .dp-btn {
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.dp-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 60;
  width: 259px;
  padding: 10px;
  background-color: var(--surface);
  background-image: var(--grain);
  border: 1px solid var(--border-strong);
  border-radius: 12px 14px 11px 15px / 14px 11px 15px 12px;
  box-shadow: var(--shadow-l);
  /* skills/emil-design-eng:弹层从触发器方向缩放,不从中心 */
  transform-origin: top right;
  animation: dp-in 0.16s var(--ease-out);
}
@keyframes dp-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dp-panel {
    animation: dp-in-fade 0.16s var(--ease-out);
  }
  @keyframes dp-in-fade {
    from {
      opacity: 0;
    }
  }
}

.dp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.dp-month {
  font-family: var(--font-hand);
  font-size: 14px;
  font-weight: 400;
  letter-spacing: 0.5px;
  color: var(--text-strong);
}
.dp-nav {
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
.dp-nav svg {
  width: 13px;
  height: 13px;
}
.dp-nav:hover {
  background: var(--surface-2);
}
.dp-nav:active {
  transform: scale(0.94);
}

.dp-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.dp-week {
  text-align: center;
  font-size: 11px;
  color: var(--text-faint);
  padding: 3px 0;
}
.dp-day {
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
.dp-day:hover {
  background: var(--surface-2);
}
.dp-day.out {
  color: var(--text-faint);
  opacity: 0.55;
}
.dp-day.today {
  box-shadow: inset 0 0 0 1px var(--border-strong);
}
.dp-day.selected {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
/* 有记录的日期:底部小圆点提示"这天有内容" */
.dp-dot {
  position: absolute;
  left: 50%;
  bottom: 3px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--accent);
  transform: translateX(-50%);
}
.dp-day.selected .dp-dot {
  background: #fff;
}

.dp-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.dp-act {
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--accent-strong);
  padding: 4px 8px;
  border-radius: var(--radius-s);
  cursor: pointer;
  transition:
    background-color 0.12s var(--ease-out),
    transform 0.12s var(--ease-out);
}
.dp-act:hover:not(:disabled) {
  background: var(--accent-soft);
}
.dp-act:active:not(:disabled) {
  transform: scale(0.94);
}
.dp-act:disabled {
  color: var(--text-faint);
  cursor: default;
}
</style>
