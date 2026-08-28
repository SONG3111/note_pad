<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { relativeTime, type NoteWithItems } from "../types";
import TodoCheckbox from "./TodoCheckbox.vue";
import { useNotesStore } from "../stores/notes";

const props = defineProps<{ note: NoteWithItems; detached?: boolean }>();

const emit = defineEmits<{
  edit: [];
  remove: [];
  togglePin: [];
  toggleItem: [itemId: string, checked: boolean];
  removeItem: [itemId: string];
  detach: [fromDrag: boolean];
}>();

// 拖出手势:按住卡片移动超过阈值 → 拖出为独立窗口
let dragStart: { x: number; y: number } | null = null;
function onDown(e: MouseEvent) {
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (t.closest("button, input, textarea, label, a")) return;
  dragStart = { x: e.clientX, y: e.clientY };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
function onMove(e: MouseEvent) {
  if (!dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  if (Math.hypot(dx, dy) > 26) {
    cancelDrag();
    emit("detach", true); // 鼠标仍按住 → 可无缝续拖
  }
}
function onUp() {
  cancelDrag();
}
function cancelDrag() {
  dragStart = null;
  window.removeEventListener("mousemove", onMove);
  window.removeEventListener("mouseup", onUp);
}

// 展开/收起状态存于 store,切换 tab 不丢失
const notesStore = useNotesStore();
const expanded = computed({
  get: () => notesStore.isExpanded(props.note.id),
  set: (v: boolean) => notesStore.setExpanded(props.note.id, v),
});
const collapsible = computed(() => props.note.items.length > 6);
const visibleItems = computed(() =>
  expanded.value ? props.note.items : props.note.items.slice(0, 6)
);

const doneCount = computed(() => props.note.items.filter((i) => i.checked).length);
const totalCount = computed(() => props.note.items.length);
const progress = computed(() => (totalCount.value === 0 ? 0 : Math.round((doneCount.value / totalCount.value) * 100)));

// 全部完成:待办区轻轻脉动一下,与顶层庆祝动画呼应(编辑器里勾完最后一项时,卡片同样响应)
const allDone = computed(() => totalCount.value >= 2 && doneCount.value === totalCount.value);
const pop = ref(false);
let popTimer: number | undefined;
watch(allDone, (v, was) => {
  if (v && !was) {
    pop.value = true;
    window.clearTimeout(popTimer);
    popTimer = window.setTimeout(() => (pop.value = false), 450);
  }
});
</script>

<template>
  <article class="card" :style="{ '--card-color': note.color ?? '#f6f7f9' }" @mousedown="onDown">
    <span v-if="detached" class="win-badge" title="该记录已在独立窗口中打开,点击可聚焦该窗口">独立窗口中</span>
    <div class="card-top">
      <span v-if="note.pinned" class="pin-badge">📌</span>
      <div class="card-actions">
        <button class="icon-btn" title="编辑" @click="emit('edit')">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
        </button>
        <button class="icon-btn" title="拖出为独立窗口" @click="emit('detach', false)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
        </button>
        <button
          class="icon-btn"
          :class="{ active: note.pinned }"
          :title="note.pinned ? '取消置顶' : '置顶'"
          @click="emit('togglePin')"
        >📌</button>
        <button class="icon-btn danger" title="删除" @click="emit('remove')">✕</button>
      </div>
    </div>

    <h3 v-if="note.title" class="title" :title="note.title">{{ note.title }}</h3>
    <p v-if="note.type === 'note' && note.content" class="content">{{ note.content }}</p>

    <div v-if="note.type === 'todo'" class="todo-area" :class="{ pop }">
      <div v-for="item in visibleItems" :key="item.id" class="todo-row">
        <TodoCheckbox :checked="item.checked" @change="emit('toggleItem', item.id, !item.checked)" />
        <span class="todo-text" :class="{ done: item.checked }">{{ item.text }}</span>
        <button class="row-del" title="删除此项" @click="emit('removeItem', item.id)">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <button v-if="collapsible" class="collapse-btn" @click="expanded = !expanded">
        <svg class="chev" :class="{ up: expanded }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
        {{ expanded ? "收起" : `展开全部 ${note.items.length} 项` }}
      </button>
      <p v-if="note.items.length === 0" class="more-hint">空待办 · 编辑添加</p>
      <div v-if="totalCount > 0" class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" :style="{ width: progress + '%' }"></div></div>
        <span class="progress-text">{{ doneCount }}/{{ totalCount }}</span>
      </div>
    </div>

    <footer class="card-footer">{{ relativeTime(note.updatedAt) }}</footer>
  </article>
</template>

<style scoped>
.card {
  background: var(--card-color);
  border: 1px solid var(--border);
  border-radius: var(--radius-l);
  padding: 38px 18px 16px;
  box-shadow: var(--shadow-s);
  transition:
    box-shadow 0.2s var(--ease-out),
    transform 0.2s var(--ease-out),
    border-color 0.2s var(--ease-out);
  position: relative;
}
.card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-m);
  transform: translateY(-2px);
}

.card-top {
  position: absolute;
  top: 10px;
  right: 12px;
  display: flex;
  gap: 4px;
}
.pin-badge {
  font-size: 12px;
}
.win-badge {
  position: absolute;
  top: 10px;
  left: 14px;
  font-size: 10.5px;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
  padding: 2px 8px;
  border-radius: 999px;
  pointer-events: none;
  letter-spacing: 0.2px;
}
.card:hover .pin-badge {
  display: none;
}
.card-actions {
  display: none;
  gap: 4px;
}
.card:hover .card-actions {
  display: flex;
}
.icon-btn {
  border: none;
  background: color-mix(in srgb, var(--card-color) 60%, var(--surface) 40%);
  border-radius: var(--radius-s);
  width: 27px;
  height: 27px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.75;
  box-shadow: var(--shadow-s);
  transition:
    opacity 0.15s var(--ease-out),
    background-color 0.15s var(--ease-out),
    box-shadow 0.15s var(--ease-out),
    transform 0.1s var(--ease-out);
  display: grid;
  place-items: center;
  padding: 0;
}
.icon-btn:active { transform: scale(0.9); }
.icon-btn:hover {
  opacity: 1;
  background: var(--surface);
  box-shadow: var(--shadow-m);
}
.icon-btn.active {
  box-shadow: inset 0 0 0 2px var(--text-faint);
  opacity: 1;
}
.icon-btn.danger { color: var(--danger); }
.icon-btn.danger:hover {
  color: var(--danger);
  background: var(--danger-soft);
}

.title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.content {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.todo-area {
  margin-top: 4px;
}
/* 全部完成:待办区集体轻微缩放脉冲 */
.todo-area.pop {
  animation: nc-todo-pop 0.4s var(--ease-in-out);
}
@keyframes nc-todo-pop {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.02); }
}
.todo-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 0;
  font-size: 13.5px;
  color: var(--text);
}
.todo-row :deep(.cb-wrap) {
  margin-top: 2px;
}
.todo-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.row-del {
  flex: none;
  border: none;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-s);
  display: grid;
  place-items: center;
  margin-left: auto;
  opacity: 0;
  transition:
    opacity 0.15s var(--ease-out),
    color 0.15s var(--ease-out),
    background-color 0.15s var(--ease-out);
}
.todo-row:hover .row-del {
  opacity: 1;
}
.row-del:hover {
  color: var(--danger);
  background-color: var(--danger-soft);
}
.todo-row .done {
  text-decoration: line-through;
  color: var(--text-faint);
}
.more-hint {
  font-size: 12px;
  color: var(--text-faint);
  margin: 4px 0 0;
}

.collapse-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: none;
  background: transparent;
  padding: 2px 0;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s var(--ease-out);
}
.collapse-btn:hover { color: var(--text-strong); }
.chev {
  width: 12px;
  height: 12px;
  transition: transform 0.18s var(--ease-in-out);
}
.chev.up { transform: rotate(180deg); }

.progress-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.progress-bar {
  flex: 1;
  height: 4px;
  background: color-mix(in srgb, var(--card-color) 30%, var(--border-strong));
  border-radius: 999px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
  transition: width 0.25s var(--ease-out);
}
.progress-text {
  font-size: 11.5px;
  color: var(--text-muted);
  min-width: 30px;
  text-align: right;
}

.card-footer {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--text-faint);
}
</style>
