<script setup lang="ts">
// 待办项下方的提醒时间小字行(Things 3 式第二行):铃铛小图标 + 紧凑时间。
// 不占行内横向空间,任何语言下都不会把待办行撑出横向滚动;
// 悬停显示完整时间。纯展示,面板交互仍在 ReminderPicker 的铃铛上。
import { useI18n } from "vue-i18n";
import { formatReminderShort, formatReminderTime } from "../types";
import { appLocale } from "../composables/useLocale";

defineProps<{ remindAt: number }>();

const { t } = useI18n();
</script>

<template>
  <div
    class="reminder-badge"
    :title="t('reminder.badgeTitle', { time: formatReminderTime(remindAt, appLocale) })"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
    <span class="rb-time">{{ formatReminderShort(remindAt, appLocale) }}</span>
  </div>
</template>

<style scoped>
/* 缩进与待办文字对齐(勾选框 ~20px + 行间距 8px) */
.reminder-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 1px 0 3px 28px;
  color: var(--accent-strong);
  font-family: var(--font-hand);
  font-size: 10px;
  line-height: 1.2;
  min-width: 0;
}
.reminder-badge svg {
  width: 10px;
  height: 10px;
  flex: none;
}
.rb-time {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
