import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { NoteWithItems, NoteType, TodoItem } from "../types";

export type ViewFilter = "all" | "todo" | "note";

export const useNotesStore = defineStore("notes", () => {
  const notes = ref<NoteWithItems[]>([]);
  const loading = ref(false);
  const searchQuery = ref("");
  const viewFilter = ref<ViewFilter>("all");
  // 待办卡片的展开状态(id -> 是否展开),未记录的默认收起
  const expandedMap = ref<Record<string, boolean>>({});

  function isExpanded(id: string): boolean {
    return expandedMap.value[id] ?? false;
  }

  function setExpanded(id: string, v: boolean) {
    expandedMap.value[id] = v;
  }

  const visible = computed(() => {
    let list = notes.value;
    if (viewFilter.value !== "all") {
      list = list.filter((n) => n.type === viewFilter.value);
    }
    const q = searchQuery.value.trim().toLowerCase();
    if (q) {
      list = list.filter((n) => {
        if (n.title?.toLowerCase().includes(q)) return true;
        if (n.content?.toLowerCase().includes(q)) return true;
        return n.items.some((i) => i.text.toLowerCase().includes(q));
      });
    }

    // 置顶(无论类型)永远最前;其余按时间倒序;"全部"tab 下同层级内待办排在便签前面
    const sorted = [...list];
    const pinRank = (n: NoteWithItems) => (n.pinned ? 0 : 1);
    const typeRank = (n: NoteWithItems) =>
      viewFilter.value === "all" ? (n.type === "todo" ? 0 : 1) : 0;
    sorted.sort(
      (a, b) => pinRank(a) - pinRank(b) || typeRank(a) - typeRank(b) || b.updatedAt - a.updatedAt
    );
    return sorted;
  });

  async function load() {
    loading.value = true;
    try {
      notes.value = await invoke<NoteWithItems[]>("list_notes");
    } finally {
      loading.value = false;
    }
  }

  function find(id: string): NoteWithItems | undefined {
    return notes.value.find((n) => n.id === id);
  }

  async function loadNote(id: string): Promise<NoteWithItems | null> {
    try {
      return await invoke<NoteWithItems>("get_note", { id });
    } catch {
      return null;
    }
  }

  /// 接收其他窗口的变更:拉取最新数据合并;笔记已被删除则从列表移除
  async function refreshNote(id: string) {
    try {
      const updated = await invoke<NoteWithItems>("get_note", { id });
      applyUpdate(updated);
    } catch {
      notes.value = notes.value.filter((n) => n.id !== id);
    }
  }

  async function create(type: NoteType, color?: string) {
    const created = await invoke<NoteWithItems>("create_note", {
      input: { type, color: color ?? null },
    });
    notes.value.unshift(created);
    return created;
  }

  async function save(id: string, patch: Partial<Pick<NoteWithItems, "title" | "content" | "color" | "pinned">>) {
    // undefined 的键不出现在 JSON 里 -> Rust 侧视为"不修改";null -> "清空"
    const input: Record<string, unknown> = {};
    if (patch.title !== undefined) input.title = patch.title;
    if (patch.content !== undefined) input.content = patch.content;
    if (patch.color !== undefined) input.color = patch.color;
    if (patch.pinned !== undefined) input.pinned = patch.pinned;
    const updated = await invoke<NoteWithItems>("update_note", { id, input });
    applyUpdate(updated);
  }

  function applyUpdate(updated: NoteWithItems) {
    const idx = notes.value.findIndex((n) => n.id === updated.id);
    if (idx >= 0) notes.value[idx] = updated;
  }

  async function remove(id: string) {
    await invoke("delete_note", { id });
    notes.value = notes.value.filter((n) => n.id !== id);
  }

  async function togglePin(id: string) {
    const note = find(id);
    if (!note) return;
    const next = !note.pinned;
    try {
      const updated = await invoke<NoteWithItems>("update_note", {
        id,
        input: { pinned: next },
      });
      applyUpdate(updated);
      // 置顶状态变化时重排:置顶的提前
      notes.value.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    } catch (e) {
      // 失败回滚本地乐观状态
      note.pinned = !next;
      throw e;
    }
  }

  async function addItem(noteId: string, text: string) {
    const item = await invoke<TodoItem>("add_todo_item", { noteId, text });
    find(noteId)?.items.push(item);
  }

  async function updateItem(noteId: string, itemId: string, patch: { text?: string; checked?: boolean }) {
    const item = await invoke<TodoItem>("update_todo_item", {
      id: itemId,
      text: patch.text ?? null,
      checked: patch.checked ?? null,
    });
    const note = find(noteId);
    if (note) {
      const idx = note.items.findIndex((i) => i.id === itemId);
      if (idx >= 0) note.items[idx] = item;
    }
  }

  async function removeItem(noteId: string, itemId: string) {
    await invoke("delete_todo_item", { id: itemId });
    const note = find(noteId);
    if (note) note.items = note.items.filter((i) => i.id !== itemId);
  }

  return {
    notes,
    loading,
    searchQuery,
    viewFilter,
    visible,
    isExpanded,
    setExpanded,
    load,
    loadNote,
    refreshNote,
    create,
    save,
    remove,
    togglePin,
    addItem,
    updateItem,
    removeItem,
    find,
  };
});
