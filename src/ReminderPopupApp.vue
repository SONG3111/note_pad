<script setup lang="ts">
// 提醒选择弹窗小窗的根组件(独立便签窗口专用):label 形如 reminder-pop-<itemId>。
// 便签窗口太小装不下日历面板,本窗口由后端 open_reminder_popup 创建并锚定在铃铛旁,
// 可完全超出便签窗口显示。面板本体复用 ReminderPanel;选择直接走 set_todo_reminder,
// 后端的 notes-changed 广播会让便签窗口/主窗口的铃铛角标自动刷新。
import { onBeforeUnmount, onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { TodoItem } from "./types";
import ReminderPanel from "./components/ReminderPanel.vue";

const appWindow = getCurrentWindow();
const itemId = appWindow.label.replace(/^reminder-pop-/, "");

const remindAt = ref<number | null>(null);
const ready = ref(false);
let closing = false;
let unlistenFocus: UnlistenFn | null = null;

function close() {
  if (closing) return;
  closing = true;
  appWindow.destroy().catch(() => {});
}

onMounted(async () => {
  try {
    const item = await invoke<TodoItem>("get_todo_item", { id: itemId });
    remindAt.value = item.remindAt;
    ready.value = true;
  } catch {
    // 待办项已被删除:弹窗失去意义,直接关闭
    close();
    return;
  }
  // 像原生下拉一样:焦点落到别处(点了便签窗口/其他应用)即关闭
  unlistenFocus = await appWindow.onFocusChanged(({ payload: focused }) => {
    if (!focused) close();
  });
});

async function onSet(next: number | null) {
  try {
    const item = await invoke<TodoItem>("set_todo_reminder", { id: itemId, remindAt: next });
    // 回写面板数据:清除按钮的显隐依赖 remindAt,不更新会一直不出现
    remindAt.value = item.remindAt;
  } catch {
    // 项被删除或已被勾选(后端拒绝):不再可设置,关闭
    close();
  }
}

// 清除提醒后关闭;普通选择保留窗口便于继续微调(与主窗口浮层行为一致)
async function onClear() {
  await onSet(null);
  close();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  unlistenFocus?.();
});
</script>

<template>
  <!-- 12px 透明边距:面板投影落在窗口内,不会被窗口边界切掉 -->
  <div class="rpop">
    <ReminderPanel v-if="ready" :remind-at="remindAt" @set="onSet" @clear="onClear" />
  </div>
</template>

<style>
/* 透明窗口需要:否则 body 默认白底破坏无边框观感 */
html,
body,
#app {
  margin: 0;
  height: 100%;
  background: transparent;
  overflow: hidden;
}
</style>

<style scoped>
.rpop {
  padding: 12px;
  animation: rpop-in 0.16s var(--ease-out);
  transform-origin: top center;
}
@keyframes rpop-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
</style>
