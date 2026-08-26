<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { storeToRefs } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNotesStore, type ViewFilter } from "./stores/notes";
import type { NoteWithItems } from "./types";
import NoteCard from "./components/NoteCard.vue";
import NoteEditor from "./components/NoteEditor.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";

const store = useNotesStore();
const { visible: visibleNotes, notes: allNotes, loading, searchQuery, viewFilter } = storeToRefs(store);

const editingId = ref<string | null>(null);
const appWindow = getCurrentWindow();

// 悬浮新建:平时收敛为右下角"＋",展开后弹出双类型胶囊;保留按页签智能显隐(待办页只给便签入口,反之亦然)
const fabOpen = ref(false);
async function fabCreate(type: "note" | "todo") {
  fabOpen.value = false;
  await newNote(type);
}

// 已拖出为独立窗口的便签 id,从主界面列表暂时隐藏
const detached = ref<Set<string>>(new Set());
let unlistenClosed: UnlistenFn | null = null;
let unlistenQuickAdd: UnlistenFn | null = null;
let unlistenChanged: UnlistenFn | null = null;

const isSearching = computed(() => searchQuery.value.trim() !== "");
// 搜索时也召回已拖出为独立窗口的便签(卡片会打角标,点击聚焦原窗口);
// 非搜索态维持隐藏,避免与悬浮窗内容重复展示。列表与页签计数必须用同一规则
const inBoard = (n: NoteWithItems) => isSearching.value || !detached.value.has(n.id);
const boardNotes = computed(() => visibleNotes.value.filter(inBoard));

function hideToTray() {
  appWindow.hide();
}

onMounted(async () => {
  await store.load();
  // 全局快捷键:Ctrl+Alt+T 快速待办 / Ctrl+Alt+N 快速便签
  unlistenQuickAdd = await listen<"todo" | "note">("quick-add", (e) => {
    newNote(e.payload);
  });
  // 独立便签窗口关闭 → 恢复显示并刷新其最新内容
  unlistenClosed = await listen<string>("note-window-closed", (e) => {
    detached.value.delete(e.payload);
    detached.value = new Set(detached.value);
    store.load();
  });
  // 其他窗口的数据变更 → 拉取合并,保证多窗口数据一致;
  // 主窗口自己发出的变更已本地应用,跳过回拉以减少 IPC 与数据库压力
  unlistenChanged = await listen<{ id: string; source: string }>("notes-changed", (e) => {
    if (e.payload.source === "main") return;
    store.refreshNote(e.payload.id);
  });
});

onBeforeUnmount(() => {
  unlistenClosed?.();
  unlistenQuickAdd?.();
  unlistenChanged?.();
});

async function detachNote(id: string, fromDrag: boolean) {
  if (editingId.value === id) editingId.value = null;
  try {
    await invoke("detach_note_window", { id, drag: fromDrag });
    detached.value = new Set([...detached.value, id]);
  } catch {}
}

// 搜索结果中点击已独立的便签:聚焦已有独立窗口(若贴边隐藏则同时唤出),不重复开新窗也不进编辑器
async function focusDetachedNote(id: string) {
  try {
    await invoke("detach_note_window", { id, drag: false });
  } catch {}
}

function onEdit(note: NoteWithItems) {
  if (detached.value.has(note.id)) focusDetachedNote(note.id);
  else editingId.value = note.id;
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
  const pool = allNotes.value.filter(inBoard);
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

    <main class="board">
      <p v-if="loading" class="empty">加载中…</p>
      <p v-else-if="boardNotes.length === 0" class="empty">
        <!-- 搜索中:永远给搜索反馈,而不是"暂无数据"的建导提示,
             否则当前页签没数据但其他页签有数据时,提示语会误导用户 -->
        <template v-if="isSearching">
          没有匹配「{{ searchQuery }}」的记录
          <br /><span class="empty-hint">换个关键词试试,或清空搜索查看全部</span>
        </template>
        <template v-else>{{ emptyHint }}</template>
      </p>

      <div v-else class="list">
        <template v-for="note in boardNotes" :key="note.id">
          <NoteCard
            :note="note"
            :detached="detached.has(note.id)"
            @edit="onEdit(note)"
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

    <!-- 悬浮新建区:透明幕布承接"点空白处收起",胶囊带错峰弹出动画 -->
    <div v-if="fabOpen" class="fab-backdrop" @click="fabOpen = false"></div>
    <div class="fab-area" :class="{ open: fabOpen }">
      <button v-if="viewFilter !== 'note'" class="fab-opt todo" @click="fabCreate('todo')">＋ 待办</button>
      <button v-if="viewFilter !== 'todo'" class="fab-opt note" @click="fabCreate('note')">＋ 便签</button>
      <button class="fab-main" :title="fabOpen ? '收起' : '新建'" aria-label="新建" @click="fabOpen = !fabOpen">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </div>

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
  position: relative;
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
  flex-direction: column;
  gap: 10px;
  padding: 10px 14px 0;
  background: #fff;
}
.tabs {
  display: flex;
  align-self: flex-start;
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
  left: 14px;
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
  /* 胶囊形(半圆端):padding 左右相应加大,避开弧边压迫文字 */
  border-radius: 999px;
  padding: 9px 16px 9px 38px;
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

.board {
  flex: 1;
  overflow-y: auto;
  /* 底部预留 76px,避免最后一张卡片被悬浮新建按钮遮挡 */
  padding: 14px 14px 76px;
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

/* 悬浮新建:主按钮白底圆形,展开时"＋"旋转 45° 变"✕";
   双胶囊白底彩描边,延续绿=待办/紫=便签的色彩语义,错峰弹出 */
.fab-backdrop {
  position: absolute;
  inset: 0;
  z-index: 40;
}
.fab-area {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}
.fab-main {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: #fff;
  color: #2c3e50;
  cursor: pointer;
  display: grid;
  place-items: center;
  box-shadow: 0 6px 18px rgba(45, 55, 72, 0.18);
  transition: transform 0.15s ease, box-shadow 0.2s ease;
}
.fab-main:hover {
  transform: scale(1.06);
  box-shadow: 0 8px 22px rgba(45, 55, 72, 0.24);
}
.fab-main:active { transform: scale(0.94); }
.fab-main svg {
  transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1);
}
.fab-area.open .fab-main svg {
  transform: rotate(45deg);
}
.fab-opt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  border-radius: 999px;
  padding: 9px 16px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.95);
  opacity: 0;
  transform: translateY(12px) scale(0.85);
  pointer-events: none;
  transition:
    opacity 0.16s ease,
    transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2),
    background-color 0.15s ease;
}
.fab-area.open .fab-opt {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
/* 便签胶囊比待办晚 50ms 弹出,收起时无延迟一起退场 */
.fab-area.open .fab-opt.note {
  transition-delay: 0.05s;
}
.fab-opt:active { transform: scale(0.94); }
.fab-opt.todo {
  color: #047857;
  box-shadow:
    inset 0 0 0 1.5px rgba(4, 120, 87, 0.35),
    0 4px 14px rgba(45, 55, 72, 0.14);
}
.fab-opt.todo:hover { background: rgba(174, 240, 213, 0.45); }
.fab-opt.note {
  color: #6d28d9;
  box-shadow:
    inset 0 0 0 1.5px rgba(109, 40, 217, 0.3),
    0 4px 14px rgba(45, 55, 72, 0.14);
}
.fab-opt.note:hover { background: rgba(228, 211, 252, 0.45); }
</style>
