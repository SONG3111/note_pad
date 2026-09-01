<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { NOTE_COLORS, type NoteWithItems } from "../types";
import { mapCardColor } from "../colors";
import TodoCheckbox from "./TodoCheckbox.vue";

const props = defineProps<{ note: NoteWithItems }>();

const emit = defineEmits<{
  close: [isEmpty: boolean];
  save: [patch: { title?: string | null; content?: string | null; color?: string | null }];
  remove: [];
  togglePin: [];
  addItem: [text: string];
  toggleItem: [itemId: string, checked: boolean];
  updateItemText: [itemId: string, text: string];
  removeItem: [itemId: string];
}>();

const title = ref(props.note.title ?? "");
const content = ref(props.note.content ?? "");
// 存量旧色值映射成手账新色, 让色卡选中态与卡片观感一致(首次保存即写回新值)
const color = ref(mapCardColor(props.note.color));
const newItemText = ref("");
const todoListRef = ref<HTMLElement | null>(null);

let saveTimer: number | undefined;
let dirty = false;

watch([title, content, color], () => {
  dirty = true;
  scheduleSave();
});

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 600);
}

function flushSave() {
  if (!dirty) return;
  dirty = false;
  emit("save", {
    title: title.value.trim() === "" ? null : title.value,
    content: content.value.trim() === "" ? null : content.value,
    color: color.value ?? null,
  });
}

function isEmptyState(): boolean {
  const hasText =
    title.value.trim() !== "" || (props.note.type === "note" && content.value.trim() !== "");
  return !hasText && props.note.items.length === 0;
}

function addOnEnter() {
  const t = newItemText.value.trim();
  if (!t) return;
  emit("addItem", t);
  newItemText.value = "";
}

// 新增待办经 IPC 异步入库后才进列表, 在 addOnEnter 里用 nextTick 滚动会跑在
// 数据到达之前而失效: 监听列表长度增长, 待新项真正渲染后再滚到底部保证可见
watch(
  () => props.note.items.length,
  async (len, old) => {
    if (len > (old ?? 0)) {
      await nextTick();
      const list = todoListRef.value;
      if (list) list.scrollTop = list.scrollHeight;
    }
  },
);

function onItemBlur(e: Event, itemId: string) {
  const text = (e.target as HTMLInputElement).value.trim();
  if (text) emit("updateItemText", itemId, text);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.clearTimeout(saveTimer);
  flushSave();
});

function close() {
  flushSave();
  emit("close", isEmptyState());
}
</script>

<template>
  <div class="overlay" @click.self="close">
    <div class="editor">
      <div class="toolbar">
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
        <div class="tools">
          <button class="tool-btn" :class="{ active: note.pinned }" title="置顶" @click="emit('togglePin')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7z"/></svg>
          </button>
          <button class="tool-btn danger" title="删除" @click="emit('remove')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/>
            </svg>
          </button>
          <button class="tool-btn close" title="关闭" @click="close">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      <input v-model="title" class="title-input" placeholder="标题" autofocus />
      <textarea
        v-if="note.type === 'note'"
        v-model="content"
        class="content-input"
        placeholder="记录你的想法…"
      ></textarea>

      <div v-else class="todo-editor">
        <div ref="todoListRef" class="todo-list">
          <div v-for="item in note.items" :key="item.id" class="item-row">
            <TodoCheckbox :checked="item.checked" @change="emit('toggleItem', item.id, !item.checked)" />
            <input class="item-text" :class="{ done: item.checked }" :value="item.text" @blur="onItemBlur($event, item.id)" />
            <button class="row-del" title="删除此项" @click="emit('removeItem', item.id)">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <input v-model="newItemText" class="new-item" placeholder="+ 添加待办,回车确认" @keydown.enter.prevent="addOnEnter" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(64, 49, 35, 0.35);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
  display: grid;
  place-items: center;
  z-index: 100;
  animation: fade-in 0.15s var(--ease-out);
}
@keyframes fade-in {
  from { opacity: 0; }
}
/* 弹窗 = 手账里被胶带贴住的一张纸条: 米纸底 + 暖墨细边 + 顶部一段和纸胶带 */
.editor {
  width: min(560px, 92vw);
  max-height: 80vh;
  /* 三段式布局:工具栏/标题固定,待办列表滚动,添加输入框固定贴底;
     面板自身不滚动(overflow:hidden),滚动内容与滚动条都不会破坏四角圆角 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  background-color: var(--surface);
  background-image: var(--grain);
  border: 1px solid var(--border-strong);
  border-radius: 16px 19px 15px 20px / 19px 15px 20px 16px;
  padding: 18px 22px;
  box-shadow: var(--shadow-l);
  animation: pop-in 0.2s var(--ease-out);
  transform-origin: center;
}
.editor::before {
  content: "";
  position: absolute;
  top: -9px;
  left: 50%;
  width: 78px;
  height: 18px;
  transform: translateX(-50%) rotate(-2deg);
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.35) 0 3px, transparent 3px 7px),
    rgba(233, 200, 122, 0.6);
  clip-path: polygon(2% 10%, 100% 0, 98% 90%, 0 100%);
  box-shadow: 0 1px 2px rgba(94, 76, 52, 0.14);
  pointer-events: none;
}
@keyframes pop-in {
  from { transform: scale(0.96) translateY(8px); opacity: 0; }
}

.toolbar {
  display: flex;
  /* nowrap:窄面板下也不允许两组按钮换行,始终同排 space-between;
     负边距抵消面板内边距,使两组按钮分别顶在面板左右两侧 */
  flex-flow: row nowrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin: 0 -14px 10px;
}
/* 颜色选择 = 一排歪贴的彩色贴纸/色卡, 选中时铅笔圈勾出 */
.colors {
  display: flex;
  gap: 7px;
  min-width: 0;
}
.color-dot {
  width: 21px;
  height: 25px;
  flex: none;
  border: none;
  border-radius: 5px 8px 5px 8px / 8px 5px 8px 5px;
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
    0 0 0 3.5px var(--ink);
  rotate: 0deg;
}

.tools { display: flex; gap: 6px; min-width: 0; }
.tool-btn {
  border: none;
  background: transparent;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: var(--radius-s);
  cursor: pointer;
  font-size: 13px;
  display: grid;
  place-items: center;
  transition:
    background-color 0.15s var(--ease-out),
    color 0.15s var(--ease-out),
    transform 0.12s var(--ease-out);
}
.tool-btn svg { display: block; }
.tool-btn:hover { background: var(--bg-soft); }
.tool-btn:active { transform: scale(0.94); }
.tool-btn.active { background: var(--accent-soft); color: var(--accent-strong); }
.tool-btn.danger { color: var(--danger); }
.tool-btn.danger:hover { background: var(--danger-soft); }
.tool-btn.close:hover {
  background: #5b5041;
  color: #fff;
}

/* 标题: 手账字体, 像纸条上手写的标题 */
.title-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-family: var(--font-hand);
  font-size: 19px;
  font-weight: 400;
  color: var(--text-strong);
  padding: 6px 0;
}
.content-input {
  width: 100%;
  flex: 1;
  min-height: 220px;
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
  font-family: inherit;
  padding: 6px 0;
}
/* 占位提示是"纸条上的批注", 用手写字体; 用户输入的正文保持系统字体 */
.content-input::placeholder {
  font-family: var(--font-hand);
  font-size: 14.5px;
  color: var(--text-faint);
}

.todo-editor {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
/* 待办项列表:唯一滚动区域,滚轮可用但滚动条不显示 */
.todo-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
}
.todo-list::-webkit-scrollbar {
  display: none;
}
.item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.item-row :deep(.cb-wrap) {
  flex: none;
}
.item-text {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: var(--text);
  padding: 4px 2px;
  border-bottom: 1px dashed transparent;
  transition:
    border-color 0.15s var(--ease-out),
    background-color 0.15s var(--ease-out);
}
.item-text:hover,
.item-text:focus {
  border-bottom-color: var(--border-strong);
  background: var(--surface-2);
}
.item-text.done { text-decoration: line-through; color: var(--text-faint); }
.row-del {
  flex: none;
  border: none;
  background: var(--danger-soft);
  color: var(--danger);
  width: 22px;
  height: 22px;
  border-radius: var(--radius-s);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition:
    background-color 0.15s var(--ease-out),
    transform 0.12s var(--ease-out);
}
.row-del:hover {
  background-color: rgba(229, 72, 77, 0.2);
}
.row-del:active {
  transform: scale(0.94);
}
/* 添加待办 = 一张虚线小纸条, 回车即写下一条 */
.new-item {
  width: 100%;
  flex: none;
  border: 1.5px dashed var(--border-strong);
  outline: none;
  background: transparent;
  border-radius: 9px 11px 9px 12px / 11px 9px 12px 9px;
  font-size: 13.5px;
  color: var(--text);
  padding: 8px 10px;
  margin-top: 8px;
  transition:
    box-shadow 0.15s var(--ease-out),
    border-color 0.15s var(--ease-out);
}
.new-item:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.new-item::placeholder {
  font-family: var(--font-hand);
  font-size: 14px;
  color: var(--text-faint);
}
</style>
