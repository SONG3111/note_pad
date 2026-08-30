import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { NoteWithItems } from "../types";

// vi.mock 会被提升到文件顶部,工厂里引用的变量必须用 vi.hoisted 提前声明
const { invokeMock, celebrateMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  celebrateMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../celebrate", () => ({ celebrateAllDone: celebrateMock }));

import { useNotesStore } from "../stores/notes";

let seq = 0;
function makeNote(partial: Partial<NoteWithItems> = {}): NoteWithItems {
  const id = partial.id ?? `n${++seq}`;
  return {
    id,
    type: "note",
    title: null,
    content: null,
    color: null,
    pinned: false,
    createdAt: new Date(2026, 7, 15, 10, 0).getTime(),
    updatedAt: new Date(2026, 7, 15, 10, 0).getTime(),
    items: [],
    ...partial,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  invokeMock.mockReset();
  celebrateMock.mockReset();
  seq = 0;
});

describe("notes store - visible 过滤链", () => {
  it("viewFilter 按类型过滤(all/todo/note)", () => {
    const store = useNotesStore();
    store.notes = [
      makeNote({ id: "n1", type: "note" }),
      makeNote({ id: "n2", type: "todo" }),
    ];
    store.viewFilter = "all";
    // 全部视图下同层级内待办排在便签前面(排序规则)
    expect(store.visible.map((n) => n.id)).toEqual(["n2", "n1"]);
    store.viewFilter = "todo";
    expect(store.visible.map((n) => n.id)).toEqual(["n2"]);
    store.viewFilter = "note";
    expect(store.visible.map((n) => n.id)).toEqual(["n1"]);
  });

  it("dateFilter 只保留创建日期匹配的记录", () => {
    const store = useNotesStore();
    const d15 = new Date(2026, 7, 15, 10, 0).getTime();
    const d22 = new Date(2026, 7, 22, 10, 0).getTime();
    store.notes = [
      makeNote({ id: "n1", createdAt: d15, updatedAt: d15 }),
      makeNote({ id: "n2", type: "todo", createdAt: d22, updatedAt: d22 }),
    ];
    store.setDateFilter("2026-08-22");
    expect(store.visible.map((n) => n.id)).toEqual(["n2"]);
    store.setDateFilter("2026-08-15");
    expect(store.visible.map((n) => n.id)).toEqual(["n1"]);
    store.setDateFilter(null);
    expect(store.visible).toHaveLength(2);
  });

  it("日期筛选与类型筛选叠加(AND)", () => {
    const store = useNotesStore();
    const d15 = new Date(2026, 7, 15, 10, 0).getTime();
    store.notes = [
      makeNote({ id: "n1", type: "note", createdAt: d15, updatedAt: d15 }),
      makeNote({ id: "n2", type: "todo", createdAt: d15, updatedAt: d15 }),
    ];
    store.viewFilter = "todo";
    store.setDateFilter("2026-08-15");
    expect(store.visible.map((n) => n.id)).toEqual(["n2"]);
  });

  it("searchQuery 命中标题/正文/待办项文本,大小写不敏感", () => {
    const store = useNotesStore();
    store.notes = [
      makeNote({ id: "n1", title: "Meeting Notes" }),
      makeNote({ id: "n2", content: "记得 Review 代码" }),
      makeNote({
        id: "n3",
        type: "todo",
        items: [{ id: "i1", noteId: "n3", text: "买牛奶", checked: false, sortOrder: 0, updatedAt: 0 }],
      }),
      makeNote({ id: "n4", title: "无关内容" }),
    ];
    store.searchQuery = "meeting";
    expect(store.visible.map((n) => n.id)).toEqual(["n1"]);
    store.searchQuery = "review";
    expect(store.visible.map((n) => n.id)).toEqual(["n2"]);
    store.searchQuery = "牛奶";
    expect(store.visible.map((n) => n.id)).toEqual(["n3"]);
    store.searchQuery = "  ";
    expect(store.visible).toHaveLength(4);
  });

  it("排序:置顶优先,同层级按 updatedAt 倒序,全部视图下待办排在便签前", () => {
    const store = useNotesStore();
    const t = (day: number) => new Date(2026, 7, day, 10, 0).getTime();
    store.notes = [
      makeNote({ id: "plain-note", type: "note", updatedAt: t(28) }),
      makeNote({ id: "todo-old", type: "todo", updatedAt: t(10) }),
      makeNote({ id: "pinned-old", type: "note", pinned: true, updatedAt: t(5) }),
    ];
    store.viewFilter = "all";
    expect(store.visible.map((n) => n.id)).toEqual([
      "pinned-old", // 置顶永远最前
      "todo-old", // 全部视图下待办优先于便签
      "plain-note",
    ]);
  });
});

describe("notes store - 数据操作走 invoke", () => {
  it("refreshNote 成功时合并最新数据", async () => {
    const store = useNotesStore();
    store.notes = [makeNote({ id: "n1", title: "旧标题" })];
    invokeMock.mockResolvedValue(makeNote({ id: "n1", title: "新标题" }));
    await store.refreshNote("n1");
    expect(store.find("n1")?.title).toBe("新标题");
  });

  it("refreshNote 失败(已删除)时把记录从列表移除", async () => {
    const store = useNotesStore();
    store.notes = [makeNote({ id: "n1" })];
    invokeMock.mockRejectedValue(new Error("gone"));
    await store.refreshNote("n1");
    expect(store.find("n1")).toBeUndefined();
  });

  it("addItem 调用 invoke 并把新待办项追加到对应笔记", async () => {
    const store = useNotesStore();
    store.notes = [makeNote({ id: "n1", type: "todo" })];
    const newItem = { id: "i9", noteId: "n1", text: "新事项", checked: false, sortOrder: 0, updatedAt: 1 };
    invokeMock.mockResolvedValue(newItem);
    await store.addItem("n1", "新事项");
    expect(invokeMock).toHaveBeenCalledWith("add_todo_item", { noteId: "n1", text: "新事项" });
    expect(store.find("n1")?.items).toHaveLength(1);
  });

  it("removeItem 调用 invoke 并从笔记中移除", async () => {
    const store = useNotesStore();
    store.notes = [
      makeNote({
        id: "n1",
        type: "todo",
        items: [{ id: "i1", noteId: "n1", text: "a", checked: false, sortOrder: 0, updatedAt: 0 }],
      }),
    ];
    invokeMock.mockResolvedValue(null);
    await store.removeItem("n1", "i1");
    expect(store.find("n1")?.items).toHaveLength(0);
  });
});

describe("notes store - 全部完成庆祝触发", () => {
  function todoNote(items: Array<{ id: string; checked: boolean }>) {
    return makeNote({
      id: "n1",
      type: "todo",
      items: items.map((i, idx) => ({
        id: i.id,
        noteId: "n1",
        text: `t${idx}`,
        checked: i.checked,
        sortOrder: idx,
        updatedAt: 0,
      })),
    });
  }

  it("勾选补齐最后一项(≥2 项)时触发 celebrateAllDone", async () => {
    const store = useNotesStore();
    store.notes = [todoNote([{ id: "i1", checked: true }, { id: "i2", checked: false }])];
    invokeMock.mockResolvedValue({ id: "i2", noteId: "n1", text: "t1", checked: true, sortOrder: 1, updatedAt: 9 });
    await store.updateItem("n1", "i2", { checked: true });
    expect(celebrateMock).toHaveBeenCalledTimes(1);
  });

  it("仅剩 1 项待办全部完成时不触发(阈值保护)", async () => {
    const store = useNotesStore();
    store.notes = [todoNote([{ id: "i1", checked: false }])];
    invokeMock.mockResolvedValue({ id: "i1", noteId: "n1", text: "t0", checked: true, sortOrder: 0, updatedAt: 9 });
    await store.updateItem("n1", "i1", { checked: true });
    expect(celebrateMock).not.toHaveBeenCalled();
  });

  it("取消勾选不触发", async () => {
    const store = useNotesStore();
    store.notes = [todoNote([{ id: "i1", checked: true }, { id: "i2", checked: true }])];
    invokeMock.mockResolvedValue({ id: "i2", noteId: "n1", text: "t1", checked: false, sortOrder: 1, updatedAt: 9 });
    await store.updateItem("n1", "i2", { checked: false });
    expect(celebrateMock).not.toHaveBeenCalled();
  });

  it("还有未完成项时不触发", async () => {
    const store = useNotesStore();
    store.notes = [todoNote([{ id: "i1", checked: false }, { id: "i2", checked: false }])];
    invokeMock.mockResolvedValue({ id: "i1", noteId: "n1", text: "t0", checked: true, sortOrder: 0, updatedAt: 9 });
    await store.updateItem("n1", "i1", { checked: true });
    expect(celebrateMock).not.toHaveBeenCalled();
  });
});
