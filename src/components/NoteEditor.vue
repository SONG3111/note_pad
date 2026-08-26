<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { NOTE_COLORS, type NoteWithItems } from "../types";
import TodoCheckbox from "./TodoCheckbox.vue";
import { useNoteDraft } from "../composables/useNoteEditor";

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

const draft = useNoteDraft((patch) => emit("save", patch));
draft.load(props.note);

const { title, content, color } = draft;
const newItemText = ref("");

function addOnEnter() {
  const t = newItemText.value.trim();
  if (!t) return;
  emit("addItem", t);
  newItemText.value = "";
}

function onItemBlur(e: Event, itemId: string) {
  const text = (e.target as HTMLInputElement).value.trim();
  if (text) emit("updateItemText", itemId, text);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function close() {
  draft.flush();
  emit("close", draft.isEmptyState(props.note.type === "note", props.note.items.length));
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
          <button class="tool-btn" :class="{ active: note.pinned }" title="置顶" @click="emit('togglePin')">📌</button>
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
        <div v-for="item in note.items" :key="item.id" class="item-row">
          <TodoCheckbox :checked="item.checked" @change="emit('toggleItem', item.id, !item.checked)" />
          <input class="item-text" :class="{ done: item.checked }" :value="item.text" @blur="onItemBlur($event, item.id)" />
          <button class="row-del" title="删除此项" @click="emit('removeItem', item.id)">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
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
  background: rgba(20, 30, 45, 0.4);
  display: grid;
  place-items: center;
  z-index: 100;
  animation: fade-in 0.15s ease;
}
@keyframes fade-in {
  from { opacity: 0; }
}
.editor {
  width: min(560px, 92vw);
  max-height: 80vh;
  overflow-y: auto;
  background: #fff;
  border-radius: 14px;
  padding: 18px 22px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  animation: pop-in 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
@keyframes pop-in {
  from { transform: scale(0.96) translateY(8px); opacity: 0; }
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.colors {
  display: flex;
  gap: 6px;
}
.color-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid #1a202c;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.color-dot:hover { transform: scale(1.15); }
.color-dot.selected {
  box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.45);
}

.tools { display: flex; gap: 6px; }
.tool-btn {
  border: none;
  background: rgba(255, 255, 255, 0.7);
  width: 28px;
  height: 28px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
  display: grid;
  place-items: center;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    transform 0.12s ease;
}
.tool-btn svg { display: block; }
.tool-btn:hover { background: #edf2f7; }
.tool-btn:active { transform: scale(0.96); }
.tool-btn.active { background: #e6f4ee; }
.tool-btn.danger { color: #c53030; }
.tool-btn.danger:hover { background: #ffe3e3; }
.tool-btn.close:hover {
  background: #2d3748;
  color: #fff;
}

.title-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 17px;
  font-weight: 600;
  color: #2c3e50;
  padding: 6px 0;
}
.content-input {
  width: 100%;
  min-height: 220px;
  border: none;
  outline: none;
  background: transparent;
  resize: vertical;
  font-size: 14px;
  line-height: 1.7;
  color: #34495e;
  font-family: inherit;
  padding: 6px 0;
}

.todo-editor { margin-top: 6px; }
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
  color: #34495e;
  padding: 4px 2px;
  border-bottom: 1px dashed transparent;
  transition: border-color 0.15s;
}
.item-text:hover, .item-text:focus { border-bottom-color: #cbd5e0; }
.item-text.done { text-decoration: line-through; color: #a0aec0; }
.row-del {
  flex: none;
  border: none;
  background: #fff1f1;
  color: #e53e3e;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    transform 0.12s ease;
}
.row-del:hover {
  background-color: #fed7d7;
}
.row-del:active {
  transform: scale(0.96);
}
.new-item {
  width: 100%;
  border: none;
  outline: none;
  background: rgba(255, 255, 255, 0.55);
  border-radius: 8px;
  font-size: 13.5px;
  color: #34495e;
  padding: 8px 10px;
  margin-top: 8px;
}
.new-item::placeholder { color: #a0aec0; }
</style>
