<script setup lang="ts">
// 主界面工具栏的日历筛选:月历选择日期,按记录创建日期过滤列表。
// 网格本体是共享组件 CalendarGrid(与提醒选择器共用),这里只管开关与底部操作
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useNotesStore } from "../stores/notes";
import { dateKey } from "../types";
import CalendarGrid from "./CalendarGrid.vue";

const { t } = useI18n();
const store = useNotesStore();
const { dateFilter } = storeToRefs(store);

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

// 有记录的日期集合(本地时区键),用于格子上打点
const notedDates = computed(() => {
  const set = new Set<string>();
  for (const n of store.notes) set.add(dateKey(n.createdAt));
  return set;
});

// 即时求值而非 setup 时缓存:组件随主窗口长驻,跨午夜后缓存的日期键会过期
function pickToday() {
  store.setDateFilter(dateKey(Date.now()));
  open.value = false;
}

function clear() {
  store.setDateFilter(null);
  open.value = false;
}

function toggleOpen() {
  open.value = !open.value;
  // 面板为 v-if 挂载,CalendarGrid 每次 open 都以 initialKey 重新初始化视图月份
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
      <!-- 选完日期即收起面板(原有交互);视图月份由 initialKey 定位 -->
      <CalendarGrid
        v-model="dateFilter"
        :initial-key="dateFilter"
        :marked-dates="notedDates"
        @update:model-value="open = false"
      />

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
