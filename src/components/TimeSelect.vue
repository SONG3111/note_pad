<script setup lang="ts">
// 时/分步进选择器:数字输入框 + 右侧上下箭头(替代旧的弹出滚动列表——
// 列表在小窗口会超出页面被截断)。聚焦后直接键入,回车/失焦提交;
// ↑↓ 键与箭头按钮单步增减并首尾回绕。无弹层,不存在截断问题。
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  /** 当前值(0..max) */
  modelValue: number;
  /** 最大值(小时 23 / 分钟 59) */
  max: number;
  /** 无障碍标签(如"小时"/"分钟") */
  ariaLabel?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

const { t } = useI18n();

const pad = (n: number) => String(n).padStart(2, "0");
const inputEl = ref<HTMLInputElement | null>(null);
// 聚焦编辑中的草稿:null = 未在编辑,显示补零的当前值。
// 编辑期间不发事件,避免逐键提交把提醒改成一串中间值
const draft = ref<string | null>(null);

const display = computed(() => draft.value ?? pad(props.modelValue));

function onInput(e: Event) {
  draft.value = (e.target as HTMLInputElement).value;
}

function startEdit() {
  draft.value = String(props.modelValue);
  // 全选便于直接键入覆盖
  inputEl.value?.select();
}

function commitDraft() {
  if (draft.value === null) return;
  const raw = draft.value;
  draft.value = null;
  const parsed = Number.parseInt(raw, 10);
  // 空输入/非数字:静默还原当前值
  if (Number.isNaN(parsed)) return;
  const clamped = Math.min(Math.max(parsed, 0), props.max);
  if (clamped !== props.modelValue) emit("update:modelValue", clamped);
}

// 单步增减,越过首尾时回绕(23→0 / 0→23)
function step(delta: number) {
  const span = props.max + 1;
  emit("update:modelValue", (props.modelValue + delta + span) % span);
}
</script>

<template>
  <div class="ts" role="group" :aria-label="props.ariaLabel">
    <input
      ref="inputEl"
      class="ts-input"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      role="spinbutton"
      :value="display"
      :aria-label="props.ariaLabel"
      :aria-valuemin="0"
      :aria-valuemax="props.max"
      :aria-valuenow="props.modelValue"
      @focus="startEdit"
      @blur="commitDraft"
      @input="onInput"
      @keydown.enter.prevent="commitDraft"
      @keydown.up.prevent="step(1)"
      @keydown.down.prevent="step(-1)"
      @keydown.esc="draft = null"
    />
    <div class="ts-steps">
      <button type="button" class="ts-step" :aria-label="t('timeSelect.increase')" @click="step(1)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>
      <button type="button" class="ts-step" :aria-label="t('timeSelect.decrease')" @click="step(-1)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ts {
  display: flex;
  align-items: stretch;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
/* 数字输入框:手写体数字,边框圆角与提醒面板的其他输入元素一致 */
.ts-input {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--border-strong);
  border-radius: 8px 10px 8px 11px / 10px 8px 11px 8px;
  background: var(--surface);
  outline: none;
  padding: 5px 8px;
  font-size: 12.5px;
  font-family: var(--font-hand);
  color: var(--text);
  text-align: center;
  transition:
    border-color 0.15s var(--ease-out),
    background-color 0.15s var(--ease-out),
    box-shadow 0.15s var(--ease-out);
}
.ts-input:hover {
  background: var(--accent-soft);
  border-color: var(--accent-line);
}
.ts-input:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

/* 上下箭头:竖排两枚小方块按钮 */
.ts-steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ts-step {
  display: grid;
  place-items: center;
  width: 20px;
  flex: 1;
  box-sizing: border-box;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-s);
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  transition:
    color 0.12s var(--ease-out),
    background-color 0.12s var(--ease-out),
    transform 0.1s var(--ease-out);
}
.ts-step svg {
  width: 11px;
  height: 11px;
}
.ts-step:hover {
  color: var(--text-strong);
  background: var(--accent-soft);
  border-color: var(--accent-line);
}
.ts-step:active {
  transform: scale(0.9);
}
</style>
