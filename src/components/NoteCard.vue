<script setup lang="ts">
import { computed, ref } from "vue";
import { relativeTime, type NoteWithItems } from "../types";
import TodoCheckbox from "./TodoCheckbox.vue";

const props = defineProps<{ note: NoteWithItems }>();

const emit = defineEmits<{
  edit: [];
  remove: [];
  togglePin: [];
  toggleItem: [itemId: string, checked: boolean];
  removeItem: [itemId: string];
}>();

const expanded = ref(true);
const collapsible = computed(() => props.note.items.length > 6);
const visibleItems = computed(() =>
  expanded.value ? props.note.items : props.note.items.slice(0, 6)
);

const doneCount = computed(() => props.note.items.filter((i) => i.checked).length);
const totalCount = computed(() => props.note.items.length);
const progress = computed(() => (totalCount.value === 0 ? 0 : Math.round((doneCount.value / totalCount.value) * 100)));
</script>

<template>
  <article class="card" :style="{ '--card-color': note.color ?? '#f6f7f9' }">
    <div class="card-top">
      <span v-if="note.pinned" class="pin-badge">📌</span>
      <div class="card-actions">
        <button class="icon-btn" title="编辑" @click="emit('edit')">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
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

    <div v-if="note.type === 'todo'" class="todo-area">
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
      <p v-if="note.items.length === 0" class="more-hint">空待办 · 点击添加</p>
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
  border-radius: 12px;
  padding: 34px 16px 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.07);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
  position: relative;
}
.card:hover {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  transform: translateY(-1px);
}

.card-top {
  position: absolute;
  top: 8px;
  right: 10px;
  display: flex;
  gap: 4px;
}
.pin-badge {
  font-size: 12px;
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
  background: rgba(255, 255, 255, 0.85);
  border-radius: 6px;
  width: 26px;
  height: 26px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.75;
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease,
    box-shadow 0.15s ease;
  display: grid;
  place-items: center;
  padding: 0;
}
.icon-btn:hover {
  opacity: 1;
  background: #fff;
}
.icon-btn.active {
  box-shadow: inset 0 0 0 2px #4a5568;
  opacity: 1;
}
.icon-btn.danger:hover {
  color: #d33;
}
.icon-btn.danger {
  color: #d33;
}

.title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: #2c3e50;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.content {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.65;
  color: #4a5568;
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
.todo-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 0;
  font-size: 13.5px;
  color: #34495e;
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
  color: #c0c8d4;
  cursor: pointer;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  margin-left: auto;
  opacity: 0;
  transition:
    opacity 0.15s ease,
    color 0.15s ease,
    background-color 0.15s ease;
}
.todo-row:hover .row-del {
  opacity: 1;
}
.row-del:hover {
  color: #e53e3e;
  background-color: rgba(229, 62, 62, 0.08);
}
.todo-row .done {
  text-decoration: line-through;
  color: #a0aec0;
}
.more-hint {
  font-size: 12px;
  color: #a0aec0;
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
  color: #718096;
  cursor: pointer;
  transition: color 0.15s ease;
}
.collapse-btn:hover { color: #2d3748; }
.chev {
  width: 12px;
  height: 12px;
  transition: transform 0.18s cubic-bezier(0.2, 0, 0, 1);
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
  background: rgba(0, 0, 0, 0.08);
  border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: #4a90d9;
  border-radius: 2px;
  transition: width 0.25s ease;
}
.progress-text {
  font-size: 11.5px;
  color: #718096;
  min-width: 30px;
  text-align: right;
}

.card-footer {
  margin-top: 10px;
  font-size: 11.5px;
  color: #a0aec0;
}
</style>
