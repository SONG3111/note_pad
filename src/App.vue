<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { storeToRefs } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNotesStore, type ViewFilter } from "./stores/notes";
import NoteCard from "./components/NoteCard.vue";
import NoteEditor from "./components/NoteEditor.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";

const store = useNotesStore();
const { visible: visibleNotes, notes: allNotes, loading, searchQuery, viewFilter } = storeToRefs(store);

const editingId = ref<string | null>(null);
const appWindow = getCurrentWindow();

// 已拖出为独立窗口的便签 id,从主界面列表暂时隐藏
const detached = ref<Set<string>>(new Set());
let unlistenClosed: UnlistenFn | null = null;

const boardNotes = computed(() => visibleNotes.value.filter((n) => !detached.value.has(n.id)));
const boardTotal = computed(() => allNotes.value.filter((n) => !detached.value.has(n.id)).length);

function hideToTray() {
  appWindow.hide();
}

onMounted(async () => {
  await store.load();
  // 全局快捷键:Ctrl+Alt+T 快速待办 / Ctrl+Alt+N 快速便签
  await listen<"todo" | "note">("quick-add", (e) => {
    newNote(e.payload);
  });
  // 独立便签窗口关闭 → 恢复显示并刷新其最新内容
  unlistenClosed = await listen<string>("note-window-closed", (e) => {
    detached.value.delete(e.payload);
    detached.value = new Set(detached.value);
    store.load();
  });
  // 任意窗口的数据变更 → 拉取合并,保证多窗口数据一致
  await listen<string>("notes-changed", (e) => {
    store.refreshNote(e.payload);
  });
});

onBeforeUnmount(() => unlistenClosed?.());

async function detachNote(id: string, fromDrag: boolean) {
  if (editingId.value === id) editingId.value = null;
  try {
    await invoke("detach_note_window", { id, drag: fromDrag });
    detached.value = new Set([...detached.value, id]);
  } catch {}
}

async function newNote(type: "note" | "todo") {
  const created = await store.create(type);
  viewFilter.value = type;
  searchQuery.value = "";
  detached.value.delete(created.id);
  editingId.value = created.id;
}

const filters: Array<{ key: ViewFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "todo", label: "待办" },
  { key: "note", label: "便签" },
];

function countOf(key: ViewFilter): number {
  const pool = allNotes.value.filter((n) => !detached.value.has(n.id));
  if (key === "all") return pool.length;
  return pool.filter((n) => n.type === key).length;
}

const emptyHint = computed(() => {
  if (viewFilter.value === "todo") return "暂无待办,添加任务来规划生活";
  if (viewFilter.value === "note") return "暂无便签,捕捉转瞬即逝的灵感";
  return "暂无任何记录,快来新建你的第一条内容吧";
});

function removeNote(id: string) {
  confirmId.value = id;
}

const confirmId = ref<string | null>(null);
function doRemove() {
  const id = confirmId.value;
  confirmId.value = null;
  if (!id) return;
  if (editingId.value === id) editingId.value = null;
  store.remove(id);
}

function closeEditor(isEmpty?: boolean) {
  const id = editingId.value;
  editingId.value = null;
  if (id && isEmpty) store.remove(id);
}
</script>

<template>
  <div class="app">
    <header class="topbar" data-tauri-drag-region>
      <h1 class="brand" data-tauri-drag-region>note pad</h1>
      <div class="win-controls">
        <button class="win-btn" title="最小化" @click="appWindow.minimize()">
          <svg width="11" height="11" viewBox="0 0 11 11"><rect x="0" y="5" width="11" height="1" fill="currentColor"/></svg>
        </button>
        <button class="win-btn" title="最大化/还原" @click="appWindow.toggleMaximize()">
          <svg width="11" height="11" viewBox="0 0 11 11"><rect x="0.5" y="0.5" width="10" height="10" fill="none" stroke="currentColor"/></svg>
        </button>
        <button class="win-btn close" title="隐藏到托盘" @click="hideToTray()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </header>

    <div class="toolbar">
      <div class="tabs">
        <button
          v-for="f in filters"
          :key="f.key"
          class="tab"
          :class="{ active: viewFilter === f.key }"
          @click="viewFilter = f.key"
        >
          {{ f.label }}
          <span v-if="f.key !== 'all'" class="count">{{ countOf(f.key) }}</span>
        </button>
      </div>
      <div class="search-wrap">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input v-model="searchQuery" class="search" type="search" placeholder="搜索便签、待办…" />
      </div>
    </div>

    <div class="create-row">
      <button v-if="viewFilter !== 'note'" class="btn todo" @click="newNote('todo')">
        <svg class="plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        待办
      </button>
      <button v-if="viewFilter !== 'todo'" class="btn note" @click="newNote('note')">
        <svg class="plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        便签
      </button>
    </div>

    <main class="board">
      <p v-if="loading" class="empty">加载中…</p>
      <p v-else-if="boardTotal === 0 && allNotes.length > 0" class="empty">便签已拖出为独立窗口<br /><span class="empty-hint">关闭对应窗口后会自动回到这里</span></p>
      <p v-else-if="boardTotal === 0" class="empty">{{ emptyHint }}</p>
      <p v-else-if="boardNotes.length === 0" class="empty">没有匹配「{{ searchQuery }}」的记录<br /><span class="empty-hint">换个关键词试试,或清空搜索查看全部</span></p>

      <div v-else class="list">
        <template v-for="note in boardNotes" :key="note.id">
          <NoteCard
            :note="note"
            @edit="editingId = note.id"
            @remove="removeNote(note.id)"
            @toggle-pin="store.togglePin(note.id)"
            @toggle-item="(itemId, checked) => store.updateItem(note.id, itemId, { checked })"
            @remove-item="(itemId) => store.removeItem(note.id, itemId)"
            @detach="(fromDrag) => detachNote(note.id, fromDrag)"
          />
          <Teleport to="body">
            <NoteEditor
              v-if="editingId === note.id"
              :note="note"
              @close="closeEditor"
              @save="(patch) => store.save(note.id, patch)"
              @remove="removeNote(note.id)"
              @toggle-pin="store.togglePin(note.id)"
              @add-item="(text) => store.addItem(note.id, text)"
              @toggle-item="(itemId, checked) => store.updateItem(note.id, itemId, { checked })"
              @update-item-text="(itemId, text) => store.updateItem(note.id, itemId, { text })"
              @remove-item="(itemId) => store.removeItem(note.id, itemId)"
            />
          </Teleport>
        </template>
      </div>
    </main>

    <ConfirmDialog
      :open="confirmId !== null"
      message="删除后无法恢复,确定要删除这条记录吗?"
      @confirm="doRemove"
      @cancel="confirmId = null"
    />
  </div>
</template>

<style>
:root {
  font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  color: #2c3e50;
  background: #eef1f5;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; }
html, body, #app { margin: 0; height: 100%; }

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 6px 16px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  z-index: 10;
  user-select: none;
}
.brand {
  margin: 0;
  font-size: 16px;
  letter-spacing: -0.5px;
  color: #2c3e50;
}
.win-controls {
  display: flex;
}
.win-btn {
  width: 38px;
  border: none;
  background: transparent;
  color: #718096;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background 0.12s, color 0.12s;
  border-radius: 6px;
}
.win-btn:hover {
  background: #edf2f7;
  color: #2d3748;
}
.win-btn.close:hover {
  background: #2d3748;
  color: #fff;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px 0;
  background: #fff;
}
.tabs {
  display: flex;
  gap: 4px;
  background: #edf2f7;
  padding: 3px;
  border-radius: 9px;
}
.tab {
  border: none;
  background: transparent;
  padding: 5px 12px;
  font-size: 12.5px;
  border-radius: 7px;
  cursor: pointer;
  color: #718096;
  transition: background 0.15s, color 0.15s;
}
.tab:hover { color: #2d3748; }
.tab.active {
  background: #fff;
  color: #2c3e50;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.count {
  font-size: 10.5px;
  opacity: 0.65;
  margin-left: 2px;
}
.search-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  margin-bottom: 10px;
}
.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: #8fa3b8;
  pointer-events: none;
}
.search {
  width: 100%;
  border: 1.5px solid #d5e0ec;
  border-radius: 10px;
  padding: 9px 14px 9px 34px;
  font-size: 13.5px;
  background: #f7fafc;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}
.search:hover {
  border-color: #b9cbdf;
}
.search:focus {
  background: #fff;
  border-color: #4a90d9;
  box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.15);
}

.create-row {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  background: #fff;
  border-bottom: 1px solid #edf2f7;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1;
  border: none;
  border-radius: 10px;
  padding: 13px 0;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  color: #fff;
  transition: background-color 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease;
}
.btn:focus-visible { outline: none; }
.btn:active { transform: scale(0.96); }
.btn .plus {
  width: 13px;
  height: 13px;
  margin-top: -1px;
}
.btn.todo {
  background: linear-gradient(270deg, #aef0d5 0%, #c8effb 100%);
  color: #047857;
  box-shadow: inset 0 0 0 1px rgba(4, 120, 87, 0.18);
}
.btn.todo:hover {
  background: linear-gradient(270deg, #96e9cb 0%, #b2e7f9 100%);
  box-shadow: inset 0 0 0 1px rgba(4, 120, 87, 0.3);
}
.btn.todo:focus-visible {
  box-shadow:
    inset 0 0 0 1px rgba(4, 120, 87, 0.3),
    0 0 0 3px rgba(4, 120, 87, 0.2);
}
.btn.note {
  background: linear-gradient(270deg, #e4d3fc 0%, #fce0ee 100%);
  color: #6d28d9;
  box-shadow: inset 0 0 0 1px rgba(109, 40, 217, 0.18);
}
.btn.note:hover {
  background: linear-gradient(270deg, #d9c4fb 0%, #fbd0e5 100%);
  box-shadow: inset 0 0 0 1px rgba(109, 40, 217, 0.3);
}
.btn.note:focus-visible {
  box-shadow:
    inset 0 0 0 1px rgba(109, 40, 217, 0.3),
    0 0 0 3px rgba(109, 40, 217, 0.2);
}

.board {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  scrollbar-width: none;
}
.board::-webkit-scrollbar {
  display: none;
}
.empty {
  text-align: center;
  margin-top: 24vh;
  color: #a0aec0;
  font-size: 14px;
  line-height: 2;
}
.empty-hint {
  font-size: 12.5px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
