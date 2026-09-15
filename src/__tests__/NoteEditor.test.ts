import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import NoteEditor from "../components/NoteEditor.vue";
import i18n from "../i18n";
import type { NoteWithItems, TodoItem } from "../types";

// 组件在 window 上挂 Escape 监听,用例间必须卸载,避免残留实例响应后续用例的按键
enableAutoUnmount(afterEach);

// 回归覆盖:
// 1) 清空待办文本后失焦:旧实现静默忽略,输入框显示空但数据仍是旧值,
//    直到下次跨窗口同步才被旧值"复活",UI 与数据失同步;
// 2) 空笔记关闭时跳过自动保存:旧实现 save 与 delete 两条 IPC 并发,
//    delete 先提交时 update_note 落空产生未处理拒绝。

beforeEach(() => {
  i18n.global.locale.value = "zh-CN";
});

let seq = 0;
function makeItem(text: string, noteId = "n1"): TodoItem {
  return {
    id: `i${++seq}`,
    noteId,
    text,
    checked: false,
    sortOrder: 0,
    updatedAt: 1,
    remindAt: null,
  };
}

function makeNote(partial: Partial<NoteWithItems> = {}): NoteWithItems {
  return {
    id: "n1",
    type: "todo",
    title: null,
    content: null,
    color: null,
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
    items: [],
    ...partial,
  };
}

function mountEditor(note: NoteWithItems) {
  return mount(NoteEditor, { props: { note }, global: { plugins: [i18n] } });
}

describe("NoteEditor 待办文本失焦", () => {
  it("清空文本后失焦:输入框还原为现值,不发更新事件", async () => {
    const wrapper = mountEditor(makeNote({ items: [makeItem("事项")] }));
    const input = wrapper.find(".item-text");
    await input.setValue("");
    await input.trigger("blur");
    expect((input.element as HTMLInputElement).value).toBe("事项");
    expect(wrapper.emitted("updateItemText")).toBeUndefined();
  });

  it("内容未变的失焦不产生写请求", async () => {
    const wrapper = mountEditor(makeNote({ items: [makeItem("事项")] }));
    const input = wrapper.find(".item-text");
    await input.setValue("事项");
    await input.trigger("blur");
    expect(wrapper.emitted("updateItemText")).toBeUndefined();
  });

  it("内容有变的失焦正常发出更新", async () => {
    const wrapper = mountEditor(makeNote({ items: [makeItem("事项")] }));
    const input = wrapper.find(".item-text");
    await input.setValue("改过的事项");
    await input.trigger("blur");
    expect(wrapper.emitted<[string, string]>("updateItemText")).toEqual([
      [expect.any(String), "改过的事项"],
    ]);
  });
});

describe("NoteEditor 关闭时的保存行为", () => {
  function pressEscape() {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  }

  it("空笔记关闭(仅换过色)不触发保存,直接发 close(true)", async () => {
    const wrapper = mountEditor(makeNote());
    // 换色使 dirty=true 但内容仍为空 → 关闭即删除路径
    await wrapper.findAll(".color-dot")[1].trigger("click");
    pressEscape();
    await flushPromises();
    expect(wrapper.emitted<[boolean]>("close")).toEqual([[true]]);
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("有内容的关闭前触发一次保存,发 close(false)", async () => {
    const wrapper = mountEditor(makeNote());
    await wrapper.find(".title-input").setValue("标题");
    pressEscape();
    await flushPromises();
    expect(wrapper.emitted("save")).toHaveLength(1);
    expect(wrapper.emitted<[boolean]>("close")).toEqual([[false]]);
  });
});
