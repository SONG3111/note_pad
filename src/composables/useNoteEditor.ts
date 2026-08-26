import { ref, watch, onBeforeUnmount } from "vue";
import type { NoteWithItems } from "../types";

export interface NotePatch {
  title: string | null;
  content: string | null;
  color: string | null;
}

/**
 * 便签标题/正文/颜色的编辑草稿:600ms 防抖自动保存。
 * 主窗口编辑弹窗与独立便签窗口共用。
 */
export function useNoteDraft(onFlush: (patch: NotePatch) => void) {
  const title = ref("");
  const content = ref("");
  const color = ref<string | null>(null);

  let dirty = false;
  let timer: number | undefined;

  /** 用数据源初始化/覆盖字段(清除脏标记) */
  function load(n: NoteWithItems) {
    title.value = n.title ?? "";
    content.value = n.content ?? "";
    color.value = n.color;
    dirty = false;
  }

  watch([title, content, color], () => {
    dirty = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, 600);
  });

  /** 立即落盘未保存的修改 */
  function flush() {
    if (!dirty) return;
    dirty = false;
    onFlush({
      title: title.value.trim() === "" ? null : title.value,
      content: content.value.trim() === "" ? null : content.value,
      color: color.value ?? null,
    });
  }

  function isDirty(): boolean {
    return dirty;
  }

  /** 内容是否全空(用于关闭时清理空记录)。isNote=便签类型才统计正文 */
  function isEmptyState(isNote: boolean, itemCount: number): boolean {
    const hasText =
      title.value.trim() !== "" || (isNote && content.value.trim() !== "");
    return !hasText && itemCount === 0;
  }

  onBeforeUnmount(() => {
    window.clearTimeout(timer);
    flush();
  });

  return { title, content, color, load, flush, isDirty, isEmptyState };
}
