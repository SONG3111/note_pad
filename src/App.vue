<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNotesStore, type ViewFilter } from "./stores/notes";
import { dateKey, formatDateLabel, type NoteWithItems } from "./types";
import { appLocale, toggleLocale } from "./composables/useLocale";
import NoteCard from "./components/NoteCard.vue";
import NoteEditor from "./components/NoteEditor.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import DatePicker from "./components/DatePicker.vue";

const { t } = useI18n();
const store = useNotesStore();
const {
  visible: visibleNotes,
  notes: allNotes,
  loading,
  searchQuery,
  viewFilter,
  dateFilter,
} = storeToRefs(store);

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
  // 无边框窗口的标题栏不可见,但任务栏/Alt+Tab 仍显示标题,跟随语言
  void appWindow.setTitle(t("app.name"));
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
  // 新记录创建于今天:清掉日期筛选,否则用户建完看不到刚建的内容
  store.setDateFilter(null);
  detached.value.delete(created.id);
  editingId.value = created.id;
}

const filters = computed<Array<{ key: ViewFilter; label: string }>>(() => [
  { key: "all", label: t("main.tabAll") },
  { key: "todo", label: t("main.tabTodo") },
  { key: "note", label: t("main.tabNote") },
]);

function countOf(key: ViewFilter): number {
  let pool = allNotes.value.filter(inBoard);
  // 计数与列表用同一套日期筛选,避免"列表有数据、页签显示 0"的错位
  if (dateFilter.value) {
    pool = pool.filter((n) => dateKey(n.createdAt) === dateFilter.value);
  }
  if (key === "all") return pool.length;
  return pool.filter((n) => n.type === key).length;
}

const isDateFiltering = computed(() => !!dateFilter.value);
const dateFilterLabel = computed(() =>
  dateFilter.value ? formatDateLabel(dateFilter.value, appLocale.value) : ""
);

const emptyHint = computed(() => {
  if (viewFilter.value === "todo") return t("main.emptyTodo");
  if (viewFilter.value === "note") return t("main.emptyNote");
  return t("main.emptyAll");
});

// 手动切换语言后同步窗口标题(任务栏/Alt+Tab 里的名字)
watch(appLocale, () => {
  void appWindow.setTitle(t("app.name"));
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
      <h1 class="brand" data-tauri-drag-region>{{ t("app.name") }}</h1>
      <div class="win-controls">
        <button class="win-btn lang" :title="t('settings.switchLanguage')" @click="toggleLocale">
          <span class="lang-label">{{ appLocale === "zh-CN" ? "EN" : "CN" }}</span>
        </button>
        <button class="win-btn" :title="t('main.minimize')" @click="appWindow.minimize()">
          <svg width="11" height="11" viewBox="0 0 11 11"><rect x="0" y="5" width="11" height="1" fill="currentColor"/></svg>
        </button>
        <button class="win-btn" :title="t('main.maximizeRestore')" @click="appWindow.toggleMaximize()">
          <svg width="11" height="11" viewBox="0 0 11 11"><rect x="0.5" y="0.5" width="10" height="10" fill="none" stroke="currentColor"/></svg>
        </button>
        <button class="win-btn close" :title="t('main.hideToTray')" @click="hideToTray()">
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
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M10.2 4.4c3.5-1.2 7 .6 7.8 3.8.7 3.1-1.6 6.2-5 6.9-3.4.6-6.7-1.4-7.4-4.5-.6-2.7 1.2-5.2 4.6-6.2z" />
          <path d="M17.6 15.8c1.2 1.3 2.3 2.7 3.2 4" />
        </svg>
        <input v-model="searchQuery" class="search" type="search" :placeholder="t('main.searchPlaceholder')" />
        <!-- 日历筛选入口收在搜索框右端:不挤占页签/搜索宽度,面板向左展开完整可见 -->
        <DatePicker />
      </div>
    </div>

    <main class="board">
      <p v-if="loading" class="empty">{{ t("main.loading") }}</p>
      <p v-else-if="boardNotes.length === 0" class="empty">
        <!-- 搜索中:永远给搜索反馈,而不是"暂无数据"的建导提示,
             否则当前页签没数据但其他页签有数据时,提示语会误导用户 -->
        <template v-if="isSearching">
          {{ t("main.searchEmpty", { query: searchQuery }) }}
          <br /><span class="empty-hint">{{ t("main.searchEmptyHint") }}</span>
        </template>
        <!-- 日期筛选生效且该日期无记录:给出筛选语境的反馈与解除入口 -->
        <template v-else-if="isDateFiltering">
          {{ t("main.dateFilterEmpty", { date: dateFilterLabel }) }}
          <br /><span class="empty-hint">{{ t("main.dateFilterEmptyHint") }}</span>
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
      <button v-if="viewFilter !== 'note'" class="fab-opt todo" @click="fabCreate('todo')">{{ t("main.fabTodo") }}</button>
      <button v-if="viewFilter !== 'todo'" class="fab-opt note" @click="fabCreate('note')">{{ t("main.fabNote") }}</button>
      <button class="fab-main" :title="fabOpen ? t('main.fabCollapse') : t('main.fabNew')" :aria-label="t('main.fabNewAria')" @click="fabOpen = !fabOpen">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 4.8c.25 4.6.32 9.5.15 14.5M4.8 12.15c4.7-.2 9.5-.15 14.4.2" /></svg>
      </button>
    </div>

    <ConfirmDialog
      :open="confirmId !== null"
      :title="t('dialog.deleteTitle')"
      :message="t('dialog.deleteMessage')"
      :confirm-text="t('dialog.delete')"
      :cancel-text="t('dialog.cancel')"
      @confirm="doRemove"
      @cancel="confirmId = null"
    />
  </div>
</template>

<style>
html,
body,
#app {
  height: 100%;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  position: relative;
  color: var(--text);
  background-color: var(--bg);
  background-image: var(--grain);
}

/* ============ 顶部栏: 手账封条, 让米纸底与纸纹贯通整个窗口 ============ */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 10px 18px;
  background: transparent;
  border-bottom: 1px solid var(--border);
  z-index: 10;
  user-select: none;
}
.brand {
  margin: 0;
  font-family: var(--font-hand);
  font-size: 16.5px;
  font-weight: 400;
  letter-spacing: 1.5px;
  color: var(--text-strong);
  display: flex;
  align-items: center;
  gap: 9px;
}
/* 品牌 logo: 一小截和纸胶带贴片 */
.brand::before {
  content: "";
  width: 17px;
  height: 12px;
  border-radius: 2px;
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.4) 0 2px, transparent 2px 5px),
    rgba(233, 200, 122, 0.72);
  transform: rotate(-8deg);
  box-shadow: 0 1px 2px rgba(94, 76, 52, 0.18);
}
.win-controls {
  display: flex;
  gap: 2px;
}
.win-btn {
  width: 34px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  border-radius: var(--radius-s);
  transition:
    background-color 0.12s var(--ease-out),
    color 0.12s var(--ease-out);
}
.win-btn:active { transform: scale(0.94); }
.win-btn:hover {
  background: var(--bg-soft);
  color: var(--text-strong);
}
/* 语言切换按钮:手写体的中/EN 小字标 */
.win-btn .lang-label {
  font-family: var(--font-hand);
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.5px;
}
.win-btn.close:hover {
  background: var(--danger);
  color: #fff;
}

/* ============ 工具栏: 页签(手账章节标签) + 搜索(小纸条) ============ */
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px 0;
  background: transparent;
}
.tabs {
  display: flex;
  gap: 2px;
  align-self: flex-end;
}
.tab {
  position: relative;
  z-index: 0;
  border: none;
  background: transparent;
  padding: 7px 10px;
  font-family: var(--font-hand);
  font-size: 14px;
  border-radius: var(--radius-s) var(--radius-s) 0 0;
  cursor: pointer;
  color: var(--text-muted);
  transition: color 0.15s var(--ease-out);
}
.tab:hover { color: var(--text-strong); }
.tab.active {
  color: var(--text-strong);
  font-weight: 600;
}
/* 选中态: 手绘荧光笔划线(黄油色不规则笔触), 垫在文字底下 */
.tab.active::after {
  content: "";
  position: absolute;
  z-index: -1;
  left: 7px;
  right: 7px;
  bottom: 2px;
  height: 7px;
  background: rgba(235, 200, 125, 0.62);
  border-radius: 6px 9px 5px 10px / 9px 5px 10px 6px;
  transform: rotate(-1.3deg);
}
.count {
  font-size: 11px;
  color: var(--text-faint);
  margin-left: 4px;
  font-weight: 500;
}
.tab.active .count { color: var(--accent-strong); }

.search-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  margin-bottom: 8px;
}
.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 15px;
  height: 15px;
  color: var(--text-muted);
  pointer-events: none;
}
/* 搜索框 = 手账工具栏里的一张小纸条 */
.search {
  width: 100%;
  border: 1px solid var(--border-strong);
  border-radius: 11px 13px 11px 14px / 13px 11px 14px 11px;
  /* 右侧留出日历按钮的落位空间; 左右收紧保证 400px 窗口下手写体占位符完整显示 */
  padding: 8px 36px 8px 32px;
  font-size: 13px;
  background: var(--surface);
  box-shadow: var(--shadow-s);
  outline: none;
  transition:
    border-color 0.15s var(--ease-out),
    box-shadow 0.15s var(--ease-out),
    background-color 0.15s var(--ease-out);
}
.search::placeholder {
  font-family: var(--font-hand);
  font-size: 12.5px;
  color: var(--text-faint);
}
.search:hover { border-color: var(--border-strong); }
.search:focus {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

/* ============ 卡片区 ============ */
.board {
  flex: 1;
  overflow-y: auto;
  padding: 8px 18px 84px;
  scrollbar-width: none;
}
.board::-webkit-scrollbar { display: none; }
.empty {
  text-align: center;
  margin-top: 22vh;
  font-family: var(--font-hand);
  font-size: 15px;
  color: var(--text-faint);
  line-height: 2;
}
.empty-hint {
  font-family: var(--font-hand);
  font-size: 13px;
  color: var(--text-faint);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ============ 悬浮新建 ============ */
.fab-backdrop {
  position: absolute;
  inset: 0;
  z-index: 40;
}
.fab-area {
  position: absolute;
  right: 18px;
  bottom: 18px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}
/* 印章式添加按钮: 暖纸底 + 手绘虚线圈 + 小星星贴片, 按下有轻微弹性 */
.fab-main {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: var(--surface);
  color: var(--accent);
  cursor: pointer;
  display: grid;
  place-items: center;
  box-shadow:
    0 2px 6px rgba(94, 76, 52, 0.18),
    0 8px 20px rgba(94, 76, 52, 0.12);
  transition:
    transform 0.25s var(--ease-spring),
    box-shadow 0.2s var(--ease-out),
    background-color 0.15s var(--ease-out);
  transform-origin: bottom right;
  position: relative;
}
.fab-main::before {
  content: "";
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  border: 1.5px dashed rgba(188, 107, 67, 0.55);
}
/* 小星星贴片: 歪贴在印章右上角 */
.fab-main::after {
  content: "";
  position: absolute;
  top: -4px;
  right: -1px;
  width: 14px;
  height: 14px;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2c.9 5.2 2.6 8.4 10 10-7.4 1.6-9.1 4.8-10 10-.9-5.2-2.6-8.4-10-10 7.4-1.6 9.1-4.8 10-10z' fill='%23f0dfae' stroke='%23bc6b43' stroke-width='1.3' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat center / contain;
  transform: rotate(14deg);
  filter: drop-shadow(0 1px 1px rgba(94, 76, 52, 0.22));
  transition: transform 0.25s var(--ease-spring);
  pointer-events: none;
}
.fab-main:hover {
  transform: scale(1.07) rotate(-3deg);
  background: #fffdf4;
  box-shadow:
    0 3px 8px rgba(94, 76, 52, 0.2),
    0 10px 24px rgba(94, 76, 52, 0.14);
}
.fab-main:active { transform: scale(0.92); }
.fab-main svg {
  transition: transform 0.2s var(--ease-in-out);
}
.fab-area.open .fab-main svg {
  transform: rotate(45deg);
}
.fab-area.open .fab-main::after {
  transform: rotate(80deg) scale(1.12);
}
/* 展开选项: 两张歪贴的小纸签 */
.fab-opt {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border-strong);
  border-radius: 10px 12px 10px 13px / 12px 10px 13px 10px;
  padding: 8px 15px;
  font-family: var(--font-hand);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  background: var(--surface);
  opacity: 0;
  transform: translateY(12px) scale(0.9);
  rotate: -1.5deg;
  pointer-events: none;
  box-shadow: var(--shadow-s);
  transition:
    opacity 0.16s var(--ease-out),
    transform 0.22s var(--ease-out),
    background-color 0.15s var(--ease-out),
    color 0.15s var(--ease-out);
}
.fab-area.open .fab-opt {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
.fab-area.open .fab-opt.note {
  transition-delay: 0.05s;
}
.fab-opt:active { transform: scale(0.94); }
.fab-opt.todo {
  color: #5f7d55;
  background: var(--todo-soft);
  border-color: rgba(125, 155, 113, 0.35);
  rotate: -1.5deg;
}
.fab-opt.todo:hover { background: rgba(125, 155, 113, 0.26); }
.fab-opt.note {
  color: #7c6a8c;
  background: var(--note-soft);
  border-color: rgba(156, 134, 172, 0.35);
  rotate: 1.5deg;
}
.fab-opt.note:hover { background: rgba(156, 134, 172, 0.26); }
</style>
