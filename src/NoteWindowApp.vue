<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useI18n } from "vue-i18n";
import { useNotesStore } from "./stores/notes";
import { NOTE_COLORS, type NoteWithItems, type TodoItem } from "./types";
import { mapCardColor } from "./colors";
import { celebrateAllDone } from "./celebrate";
import { appLocale } from "./composables/useLocale";
import TodoCheckbox from "./components/TodoCheckbox.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import ReminderPicker from "./components/ReminderPicker.vue";
import ReminderBadge from "./components/ReminderBadge.vue";

const { t } = useI18n();
const appWindow = getCurrentWindow();
const label = appWindow.label;
const noteId = label.replace(/^note-/, "");

// 拖出/按钮脱离的入场:窗口以 hidden 创建(见后端 detach_note_window),首帧就绪后
// 本窗口 show() 并做一次极轻淡入——主窗口纸片飞行的末态即本窗口的初始态,
// 不再做 scale pop,避免"两段动画拼接"的跳跃感。减少动效偏好下直接显示不淡入
const detachEntry: boolean = (() => {
  const q = new URLSearchParams(window.location.search);
  if (q.get("detach") !== "1") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
})();
/** 淡入开关:false=透明(入场前),true=渐入 */
const entered = ref(false);

const store = useNotesStore();
const note = ref<NoteWithItems | null>(null);
const title = ref("");
const content = ref("");
const color = ref<string | null>(null);
const items = ref<TodoItem[]>([]);
const onTop = ref(false);
const newItemText = ref("");
const confirmDelete = ref(false);
const missing = ref(false);
const scrollAreaRef = ref<HTMLElement | null>(null);
let unlistenChanged: UnlistenFn | null = null;
let unlistenClose: UnlistenFn | null = null;

onMounted(async () => {
  const loaded = await store.loadNote(noteId);
  if (!loaded) {
    missing.value = true;
  } else {
    applyLoaded(loaded);
  }

  // 窗口隐身创建:内容首帧就绪后才显示并聚焦,与主窗口纸片交接同帧发生;
  // 显示后下一帧再翻 entered,保证淡入从 opacity 0 起步而不是跳变
  await appWindow.show().catch(() => {});
  await appWindow.setFocus().catch(() => {});
  if (detachEntry) {
    requestAnimationFrame(() => {
      entered.value = true;
    });
  } else {
    entered.value = true;
  }

  // 首帧就绪:通知主窗口撤走拖出动画的占位纸片,完成"纸片→窗口"交接
  emit("note-window-ready", noteId).catch(() => {});

  // 首次被用户拖动才注册进贴边停靠管理:新建落点可能在屏幕边缘附近,
  // 立即注册会被 dock 的"边缘停留即吸附"当场把窗口贴边隐藏
  let dockRegistered = false;
  const unlistenMoved = await appWindow.onMoved(() => {
    if (dockRegistered) return;
    dockRegistered = true;
    invoke("register_note_dock", { label }).catch(() => {});
  });
  onBeforeUnmount(() => unlistenMoved());

  // 其他窗口修改了这条便签 → 同步到本窗口(本地有未保存修改时以本窗口为准);
  // 本窗口发出的变更已本地应用,跳过回拉以减少 IPC 与数据库压力。
  // dirty 之外还要挡 saving:flushSave 在 IPC 在途时就已把 dirty 置回 false,
  // 若此时放行远端回拉,会把用户刚输入、尚未落库的内容覆盖回旧值
  unlistenChanged = await listen<{ id: string; source: string }>("notes-changed", async (e) => {
    if (e.payload.id !== noteId || e.payload.source === label || !note.value || dirty || saving)
      return;
    const fresh = await store.loadNote(noteId);
    if (!fresh) {
      missing.value = true;
      return;
    }
    applyLoaded(fresh);
  });

  // 系统关闭路径(Alt+F4/任务栏关闭):注册 JS 监听后 Tauri 自动阻止原生关闭,
  // 这里走与关闭按钮相同的"保存 → 清理空笔记"流程再 destroy 真正关窗,
  // 否则 webview 直接销毁,防抖中的最后 600ms 输入来不及落库
  unlistenClose = await appWindow.onCloseRequested(async (e) => {
    e.preventDefault();
    await closeWindowCore();
    await appWindow.destroy();
  });
});

function applyLoaded(loaded: NoteWithItems) {
  applyingRemote = true;
  note.value = loaded;
  title.value = loaded.title ?? "";
  content.value = loaded.content ?? "";
  color.value = mapCardColor(loaded.color);
  items.value = loaded.items;
  // watch 是异步冲刷的, nextTick 后再解除屏蔽, 保证本轮赋值不触发自动保存
  nextTick(() => {
    applyingRemote = false;
  });
}

let saveTimer: number | undefined;
let dirty = false;
// 保存 IPC 在途标志:flushSave 已把 dirty 置回 false,但新值尚未落库,
// 期间到来的跨窗口同步不能回拉覆盖(见上方 notes-changed 守卫)
let saving = false;
// 程序化加载(打开窗口/跨窗口同步)期间的赋值不算用户编辑:
// 色值映射可能改写 color 而触发保存 watch, 用该标记屏蔽, 避免打开窗口就写库
let applyingRemote = false;

watch([title, content, color], () => {
  if (applyingRemote) return;
  dirty = true;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 600);
});

async function flushSave() {
  if (!dirty || !note.value) return;
  dirty = false;
  saving = true;
  const updated = await invoke<NoteWithItems | null>("update_note", {
    id: noteId,
    input: {
      title: title.value.trim() === "" ? null : title.value,
      content: content.value.trim() === "" ? null : content.value,
      color: color.value ?? null,
    },
  }).catch(() => null);
  saving = false;
  if (updated) items.value = updated.items;
}

function isEmptyState(): boolean {
  const hasText =
    title.value.trim() !== "" || (note.value?.type === "note" && content.value.trim() !== "");
  return !hasText && items.value.length === 0;
}

async function togglePin() {
  const next = !onTop.value;
  try {
    await invoke("set_window_on_top", { label, top: next });
    onTop.value = next;
  } catch {}
}

async function addOnEnter() {
  const t = newItemText.value.trim();
  if (!t) return;
  try {
    const item = await invoke<TodoItem>("add_todo_item", { noteId, text: t });
    items.value.push(item);
    newItemText.value = "";
    // 项多时列表已滚动:滚到底,让新添加的项立即可见
    nextTick(() => {
      const area = scrollAreaRef.value;
      if (area) area.scrollTop = area.scrollHeight;
    });
  } catch {}
}

async function toggleItem(itemId: string, checked: boolean) {
  try {
    const item = await invoke<TodoItem>("update_todo_item", {
      id: itemId,
      text: null,
      checked,
    });
    const idx = items.value.findIndex((i) => i.id === itemId);
    if (idx >= 0) items.value[idx] = item;
    // 全部完成庆祝:独立窗口不走 store,需在此独立检测(至少 2 项);
    // 只播顶层庆祝动画,待办行本身不做缩放脉冲
    if (
      checked &&
      note.value?.type === "todo" &&
      items.value.length >= 2 &&
      items.value.every((i) => i.checked)
    ) {
      celebrateAllDone();
    }
  } catch {}
}

async function updateItemText(itemId: string, text: string) {
  if (!text) return;
  try {
    const item = await invoke<TodoItem>("update_todo_item", {
      id: itemId,
      text,
      checked: null,
    });
    const idx = items.value.findIndex((i) => i.id === itemId);
    if (idx >= 0) items.value[idx] = item;
  } catch {}
}

// 待办项文本失焦:空文本不落库(后端拒绝),把输入框还原为现值,
// 避免"看似删掉了文字、刷新后又回来"的 UI 与数据失同步;内容未变也不发写请求
function onItemTextBlur(e: Event, itemId: string) {
  const el = e.target as HTMLInputElement;
  const text = el.value.trim();
  const item = items.value.find((i) => i.id === itemId);
  if (!item) return;
  if (!text) {
    el.value = item.text;
    return;
  }
  if (text !== item.text) updateItemText(itemId, text);
}

async function removeItem(itemId: string) {
  try {
    await invoke("delete_todo_item", { id: itemId });
    items.value = items.value.filter((i) => i.id !== itemId);
  } catch {}
}

// 设置/清除提醒:独立窗口不走 store,直接 invoke 并替换本行数据
async function setReminder(itemId: string, remindAt: number | null) {
  try {
    const item = await invoke<TodoItem>("set_todo_reminder", { id: itemId, remindAt });
    const idx = items.value.findIndex((i) => i.id === itemId);
    if (idx >= 0) items.value[idx] = item;
  } catch {}
}

async function doDelete() {
  confirmDelete.value = false;
  try {
    await invoke("delete_note", { id: noteId });
  } catch {}
  // destroy 直达:笔记已删,无需再走 CloseRequested 的保存流程
  await appWindow.destroy();
}

// 保存 + 空笔记清理,不含关窗动作本身:关闭按钮与系统关闭路径(Alt+F4)共用
async function closeWindowCore() {
  // 必须 await:否则关窗会在保存完成前销毁 webview,丢失最后 600ms 内的输入
  await flushSave();
  // 与主界面行为一致:全空的内容关闭即清理
  if (isEmptyState()) {
    try {
      await invoke("delete_note", { id: noteId });
    } catch {}
  }
}

async function closeWindow() {
  await closeWindowCore();
  // destroy 而非 close:close 会再触发一次 CloseRequested(被上面的监听拦截成
  // 递归保存),destroy 直接销毁并仍会走 Rust 侧 Destroyed 清理
  await appWindow.destroy();
}

function onKeydown(e: KeyboardEvent) {
  // 删除确认框开着时 Escape 只取消对话框(ConfirmDialog 内已拦截传播),此处再加一道保险
  if (e.key === "Escape" && !confirmDelete.value) closeWindow();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.clearTimeout(saveTimer);
  flushSave();
  unlistenChanged?.();
  unlistenClose?.();
});

const isTodo = computed(() => note.value?.type === "todo");
const doneCount = computed(() => items.value.filter((i) => i.checked).length);
const progress = computed(() =>
  items.value.length === 0 ? 0 : Math.round((doneCount.value / items.value.length) * 100)
);

// 语言切换后同步窗口标题(任务栏/Alt+Tab 显示用)
watch(appLocale, () => {
  appWindow.setTitle(t("app.name")).catch(() => {});
});
</script>

<template>
  <div
    class="nwin"
    :class="{ 'nwin-pre': detachEntry && !entered, 'nwin-in': detachEntry && entered }"
    :style="{ '--card-color': mapCardColor(color) }"
  >
    <header class="bar" data-tauri-drag-region>
      <span class="dot" data-tauri-drag-region></span>
      <div class="tools">
        <button
          class="tool-btn"
          :class="{ active: onTop }"
          :title="onTop ? t('noteWindow.unpinTitle') : t('noteWindow.pinTitle')"
          @click="togglePin"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7z"/>
          </svg>
        </button>
        <button class="tool-btn danger" :title="t('noteWindow.deleteNote')" @click="confirmDelete = true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/>
          </svg>
        </button>
        <button class="tool-btn close" :title="t('noteWindow.closeBack')" @click="closeWindow">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </header>

    <p v-if="missing" class="missing">{{ t("noteWindow.missing") }}</p>

    <div v-else-if="note" class="body">
      <input v-model="title" class="title-input" :placeholder="t('editor.titlePlaceholder')" />
      <textarea
        v-if="!isTodo"
        v-model="content"
        class="content-input"
        :placeholder="t('editor.contentPlaceholder')"
      ></textarea>

      <div v-else class="todo-editor">
        <div ref="scrollAreaRef" class="scroll-area">
          <div class="todo-stats">
            <div class="stats-bar"><div class="stats-fill" :style="{ width: progress + '%' }"></div></div>
            <span class="stats-text">{{ doneCount }}/{{ items.length }}</span>
          </div>
          <div v-for="item in items" :key="item.id" class="item-block">
            <div class="item-row">
              <TodoCheckbox :checked="item.checked" @change="toggleItem(item.id, !item.checked)" />
              <input
                class="item-text"
                :class="{ done: item.checked }"
                :value="item.text"
                @blur="(e) => onItemTextBlur(e, item.id)"
              />
              <!-- popup 模式:便签窗口装不下日历面板,点击铃铛在按钮旁弹出
                   可超出窗口边界的独立小窗(见 ReminderPopupApp) -->
              <ReminderPicker
                v-if="!item.checked"
                mode="popup"
                :item-id="item.id"
                :remind-at="item.remindAt"
                @set="(remindAt) => setReminder(item.id, remindAt)"
              />
              <button class="row-del" :title="t('editor.deleteItem')" @click="removeItem(item.id)">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <!-- 提醒时间放文字下方第二行(Things 3 式),不占行内横向空间 -->
            <ReminderBadge v-if="!item.checked && item.remindAt" :remind-at="item.remindAt" />
          </div>
        </div>
        <input v-model="newItemText" class="new-item" :placeholder="t('editor.addItemPlaceholder')" @keydown.enter.prevent="addOnEnter" />
      </div>

      <div class="colors">
        <button
          v-for="c in NOTE_COLORS"
          :key="c"
          class="color-dot"
          :class="{ selected: color === c || (!color && c === NOTE_COLORS[0]) }"
          :style="{ background: c }"
          @click="color = c"
        ></button>
      </div>
    </div>

    <ConfirmDialog
      :open="confirmDelete"
      :title="t('dialog.deleteTitle')"
      :message="t('dialog.deleteMessage')"
      :confirm-text="t('dialog.delete')"
      :cancel-text="t('dialog.cancel')"
      @confirm="doDelete"
      @cancel="confirmDelete = false"
    />
  </div>
</template>

<style>
/* 全局重置:透明窗口需要,否则 body 默认白边破坏圆角 */
html, body, #app {
  margin: 0;
  height: 100%;
  background: transparent;
  overflow: hidden;
}
body {
  background: transparent;
}
</style>

<style scoped>
/* 独立便签 = 从手账上揭下来的一张彩色纸条 */
.nwin {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 10px);
  margin: 5px;
  background-color: var(--card-color);
  background-image: var(--grain);
  border-radius: 16px 18px 15px 19px / 18px 15px 19px 16px;
  overflow: hidden;
  box-shadow:
    inset 0 0 0 1px rgba(94, 76, 52, 0.08),
    0 10px 30px -10px rgba(94, 76, 52, 0.45);
}
/* 拖出入场:主窗口纸片飞行的末态 = 本窗口初始态(位置/尺寸由后端落点公式保证),
   因此入场只做一次极轻淡入与纸片的淡出交叉溶解,交接处无可感知边界;
   不再做 scale pop——那是"第二段动画",会与纸片飞行打架 */
.nwin-pre {
  opacity: 0;
}
.nwin-in {
  transition: opacity 0.14s var(--ease-out);
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 6px 16px;
  background: rgba(255, 253, 246, 0.72);
  border-bottom: 1px solid rgba(94, 76, 52, 0.08);
  user-select: none;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--todo);
  box-shadow: 0 0 0 3px var(--todo-soft);
}
.tools {
  display: flex;
  gap: 4px;
}
.tool-btn {
  border: none;
  background: transparent;
  width: 27px;
  height: 25px;
  border-radius: var(--radius-s);
  cursor: pointer;
  color: var(--text-muted);
  display: grid;
  place-items: center;
  transition:
    background-color 0.15s var(--ease-out),
    color 0.15s var(--ease-out),
    transform 0.1s var(--ease-out);
}
.tool-btn:active { transform: scale(0.92); }
.tool-btn svg { display: block; }
.tool-btn:hover { background: var(--bg-soft); color: var(--text-strong); }
.tool-btn.active { background: var(--todo-soft); color: var(--todo); }
.tool-btn.danger:hover { background: var(--danger-soft); color: var(--danger); }
.tool-btn.close:hover { background: #5b5041; color: #fff; }

.missing {
  margin: auto;
  color: var(--text-faint);
  font-size: 13px;
}

.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px 18px 16px;
  overflow: hidden;
  min-height: 0;
}
.title-input {
  flex: none;
  border: none;
  outline: none;
  background: transparent;
  font-family: var(--font-hand);
  font-size: 17px;
  font-weight: 400;
  color: var(--text-strong);
  padding: 4px 0 8px;
}
.content-input {
  flex: 1;
  min-height: 160px;
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--text);
  font-family: inherit;
}
.todo-editor {
  margin-top: 2px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.scroll-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  scrollbar-width: none;
}
.scroll-area::-webkit-scrollbar {
  display: none;
}
.todo-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.stats-bar {
  flex: 1;
  height: 4px;
  background: color-mix(in srgb, var(--card-color) 40%, var(--border-strong));
  border-radius: 999px;
  overflow: hidden;
}
.stats-fill {
  height: 100%;
  background: var(--todo);
  border-radius: 999px;
  transition: width 0.25s var(--ease-out);
}
.stats-text {
  font-size: 11.5px;
  color: var(--text-muted);
  white-space: nowrap;
}
.item-block {
  min-width: 0;
}
.item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.item-row :deep(.cb-wrap) { flex: none; }
.item-text {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13.5px;
  color: var(--text);
  padding: 4px 2px;
  border-bottom: 1px dashed transparent;
  transition: border-color 0.15s var(--ease-out);
}
.item-text:hover, .item-text:focus { border-bottom-color: var(--border-strong); }
.item-text.done { text-decoration: line-through; color: var(--text-faint); }
.row-del {
  border: none;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  opacity: 0;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-s);
  display: grid;
  place-items: center;
  transition:
    opacity 0.15s var(--ease-out),
    color 0.15s var(--ease-out),
    background-color 0.15s var(--ease-out);
}
.item-row:hover .row-del { opacity: 1; }
.row-del:hover { color: var(--danger); background: var(--danger-soft); }
.new-item {
  width: 100%;
  flex: none;
  border: 1.5px dashed rgba(94, 76, 52, 0.22);
  outline: none;
  background: rgba(255, 255, 255, 0.35);
  border-radius: 9px 11px 9px 12px / 11px 9px 12px 9px;
  font-size: 13px;
  color: var(--text);
  padding: 8px 10px;
  margin-top: 6px;
  transition: border-color 0.15s var(--ease-out);
}
.new-item:focus { border-color: var(--accent); }
.new-item::placeholder {
  font-family: var(--font-hand);
  font-size: 13.5px;
  color: var(--text-faint);
}
.content-input::placeholder {
  font-family: var(--font-hand);
  font-size: 14px;
  color: var(--text-faint);
}

.colors {
  display: flex;
  gap: 6px;
  flex: none;
  padding-top: 12px;
}
/* 色卡贴纸: 歪贴的小纸片, 选中时铅笔圈勾出 */
.color-dot {
  width: 18px;
  height: 22px;
  border: none;
  border-radius: 4px 6px 4px 6px / 6px 4px 6px 4px;
  box-shadow:
    inset 0 0 0 1px rgba(94, 76, 52, 0.15),
    0 1px 2px rgba(94, 76, 52, 0.16);
  cursor: pointer;
  rotate: -2.5deg;
  transition:
    transform 0.15s var(--ease-out),
    box-shadow 0.15s var(--ease-out),
    rotate 0.15s var(--ease-out);
}
.color-dot:nth-child(even) { rotate: 2.5deg; }
.color-dot:hover { transform: translateY(-2px) scale(1.06); }
.color-dot.selected {
  box-shadow:
    0 0 0 2px var(--surface),
    0 0 0 3px var(--ink);
  rotate: 0deg;
}
</style>
