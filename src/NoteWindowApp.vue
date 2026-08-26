<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNotesStore } from "./stores/notes";
import { NOTE_COLORS, type NoteWithItems, type TodoItem } from "./types";
import { celebrateAllDone } from "./celebrate";
import TodoCheckbox from "./components/TodoCheckbox.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";

const appWindow = getCurrentWindow();
const label = appWindow.label;
const noteId = label.replace(/^note-/, "");

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
let unlistenChanged: UnlistenFn | null = null;

onMounted(async () => {
  const loaded = await store.loadNote(noteId);
  if (!loaded) {
    missing.value = true;
    return;
  }
  applyLoaded(loaded);

  // 其他窗口修改了这条便签 → 同步到本窗口(本地有未保存修改时以本窗口为准);
  // 本窗口发出的变更已本地应用,跳过回拉以减少 IPC 与数据库压力
  unlistenChanged = await listen<{ id: string; source: string }>("notes-changed", async (e) => {
    if (e.payload.id !== noteId || e.payload.source === label || !note.value || dirty) return;
    const fresh = await store.loadNote(noteId);
    if (!fresh) {
      missing.value = true;
      return;
    }
    applyLoaded(fresh);
  });
});

function applyLoaded(loaded: NoteWithItems) {
  note.value = loaded;
  title.value = loaded.title ?? "";
  content.value = loaded.content ?? "";
  color.value = loaded.color;
  items.value = loaded.items;
}

let saveTimer: number | undefined;
let dirty = false;

watch([title, content, color], () => {
  dirty = true;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 600);
});

async function flushSave() {
  if (!dirty || !note.value) return;
  dirty = false;
  const updated = await invoke<NoteWithItems | null>("update_note", {
    id: noteId,
    input: {
      title: title.value.trim() === "" ? null : title.value,
      content: content.value.trim() === "" ? null : content.value,
      color: color.value ?? null,
    },
  }).catch(() => null);
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

async function removeItem(itemId: string) {
  try {
    await invoke("delete_todo_item", { id: itemId });
    items.value = items.value.filter((i) => i.id !== itemId);
  } catch {}
}

async function doDelete() {
  confirmDelete.value = false;
  try {
    await invoke("delete_note", { id: noteId });
    appWindow.close();
  } catch {}
}

async function closeWindow() {
  // 必须 await:否则 close() 会在保存完成前销毁窗口,丢失最后 600ms 内的输入
  await flushSave();
  // 与主界面行为一致:全空的内容关闭即清理
  if (isEmptyState()) {
    try {
      await invoke("delete_note", { id: noteId });
    } catch {}
  }
  appWindow.close();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") closeWindow();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.clearTimeout(saveTimer);
  flushSave();
  unlistenChanged?.();
});

const isTodo = computed(() => note.value?.type === "todo");
const doneCount = computed(() => items.value.filter((i) => i.checked).length);
const progress = computed(() =>
  items.value.length === 0 ? 0 : Math.round((doneCount.value / items.value.length) * 100)
);
</script>

<template>
  <div class="nwin" :style="{ '--card-color': color ?? '#f6f7f9' }">
    <header class="bar" data-tauri-drag-region>
      <span class="dot" data-tauri-drag-region></span>
      <div class="tools">
        <button
          class="tool-btn"
          :class="{ active: onTop }"
          :title="onTop ? '取消置顶' : '置顶显示'"
          @click="togglePin"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7z"/>
          </svg>
        </button>
        <button class="tool-btn danger" title="删除便签" @click="confirmDelete = true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/>
          </svg>
        </button>
        <button class="tool-btn close" title="关闭并放回列表" @click="closeWindow">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </header>

    <p v-if="missing" class="missing">该便签不存在或已删除</p>

    <div v-else-if="note" class="body">
      <input v-model="title" class="title-input" placeholder="标题" />
      <textarea
        v-if="!isTodo"
        v-model="content"
        class="content-input"
        placeholder="记录你的想法…"
      ></textarea>

      <div v-else class="todo-editor">
        <div class="scroll-area">
          <div class="todo-stats">
            <div class="stats-bar"><div class="stats-fill" :style="{ width: progress + '%' }"></div></div>
            <span class="stats-text">{{ doneCount }}/{{ items.length }}</span>
          </div>
          <div v-for="item in items" :key="item.id" class="item-row">
            <TodoCheckbox :checked="item.checked" @change="toggleItem(item.id, !item.checked)" />
            <input
              class="item-text"
              :class="{ done: item.checked }"
              :value="item.text"
              @blur="(e) => updateItemText(item.id, (e.target as HTMLInputElement).value.trim())"
            />
            <button class="row-del" title="删除此项" @click="removeItem(item.id)">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <input v-model="newItemText" class="new-item" placeholder="+ 添加待办,回车确认" @keydown.enter.prevent="addOnEnter" />
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
      message="删除后无法恢复,确定要删除这条记录吗?"
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
</style>

<style scoped>
.nwin {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 8px);
  margin: 4px;
  background: var(--card-color);
  border-radius: 14px;
  overflow: hidden;
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.08),
    0 6px 24px -8px rgba(45, 55, 72, 0.35);
  font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 4px 14px;
  background: rgba(255, 255, 255, 0.65);
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  user-select: none;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #059669;
}
.tools {
  display: flex;
  gap: 4px;
}
.tool-btn {
  border: none;
  background: transparent;
  width: 26px;
  height: 24px;
  border-radius: 6px;
  cursor: pointer;
  color: #718096;
  display: grid;
  place-items: center;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}
.tool-btn svg { display: block; }
.tool-btn:hover { background: #edf2f7; color: #2d3748; }
.tool-btn.active { background: #d1fae5; color: #047857; }
.tool-btn.danger:hover { background: #fee2e2; color: #c53030; }
.tool-btn.close:hover { background: #2d3748; color: #fff; }

.missing {
  margin: auto;
  color: #a0aec0;
  font-size: 13px;
}

.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 10px 16px 14px;
  overflow: hidden;
  min-height: 0;
}
.title-input {
  flex: none;
  border: none;
  outline: none;
  background: transparent;
  font-size: 16px;
  font-weight: 600;
  color: #2c3e50;
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
  color: #34495e;
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
  background: rgba(0, 0, 0, 0.08);
  border-radius: 2px;
  overflow: hidden;
}
.stats-fill {
  height: 100%;
  background: #059669;
  border-radius: 2px;
  transition: width 0.25s ease;
}
.stats-text {
  font-size: 11.5px;
  color: #718096;
  white-space: nowrap;
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
  color: #34495e;
  padding: 4px 2px;
  border-bottom: 1px dashed transparent;
}
.item-text:hover, .item-text:focus { border-bottom-color: #cbd5e0; }
.item-text.done { text-decoration: line-through; color: #a0aec0; }
.row-del {
  border: none;
  background: transparent;
  color: #c0c8d4;
  cursor: pointer;
  opacity: 0;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  transition:
    opacity 0.15s ease,
    color 0.15s ease,
    background-color 0.15s ease;
}
.item-row:hover .row-del { opacity: 1; }
.row-del:hover { color: #e53e3e; background: rgba(229, 62, 62, 0.08); }
.new-item {
  width: 100%;
  flex: none;
  border: none;
  outline: none;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 8px;
  font-size: 13px;
  color: #34495e;
  padding: 8px 10px;
  margin-top: 6px;
}
.new-item::placeholder { color: #a0aec0; }

.colors {
  display: flex;
  gap: 6px;
  flex: none;
  padding-top: 12px;
}
.color-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid #1a202c;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.color-dot:hover { transform: scale(1.15); }
.color-dot.selected { box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.45); }
</style>
