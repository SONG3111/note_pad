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

// 按命令分流 mock:待办项级操作现在会追加一次 get_note 补拉笔记 updated_at
function mockInvoke(handlers: Record<string, (args?: Record<string, unknown>) => unknown>) {
  invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    const handler = handlers[cmd];
    if (!handler) return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    return Promise.resolve(handler(args));
  });
}

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
        items: [{ id: "i1", noteId: "n3", text: "买牛奶", checked: false, sortOrder: 0, updatedAt: 0, remindAt: null }],
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

  it("排序:置顶优先,同层级按 createdAt 倒序,全部视图下待办排在便签前", () => {
    const store = useNotesStore();
    const t = (day: number) => new Date(2026, 7, day, 10, 0).getTime();
    store.notes = [
      makeNote({ id: "plain-note", type: "note", createdAt: t(28) }),
      makeNote({ id: "todo-old", type: "todo", createdAt: t(10), updatedAt: t(29) }),
      makeNote({ id: "pinned-old", type: "note", pinned: true, createdAt: t(5) }),
    ];
    store.viewFilter = "all";
    expect(store.visible.map((n) => n.id)).toEqual([
      "pinned-old", // 置顶永远最前
      "todo-old", // 全部视图下待办优先于便签
      "plain-note", // createdAt 最新;todo-old 的 updatedAt 更新也不改变顺序
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

  it("refreshNote 失败(NOTE_NOT_FOUND)时把记录从列表移除", async () => {
    const store = useNotesStore();
    store.notes = [makeNote({ id: "n1" })];
    invokeMock.mockRejectedValue("NOTE_NOT_FOUND");
    await store.refreshNote("n1");
    expect(store.find("n1")).toBeUndefined();
  });

  it("refreshNote 瞬时失败(DB_BUSY)时保留本地数据不误删", async () => {
    const store = useNotesStore();
    store.notes = [makeNote({ id: "n1", title: "正在编辑" })];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeMock.mockRejectedValue("DB_BUSY");
    await store.refreshNote("n1");
    // 瞬时错误:笔记仍在,数据未被破坏
    expect(store.find("n1")?.title).toBe("正在编辑");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("addItem 调用 invoke 追加待办项,并补拉刷新笔记 updatedAt", async () => {
    const store = useNotesStore();
    store.notes = [makeNote({ id: "n1", type: "todo" })];
    const newItem = { id: "i9", noteId: "n1", text: "新事项", checked: false, sortOrder: 0, updatedAt: 1, remindAt: null };
    mockInvoke({
      add_todo_item: () => newItem,
      get_note: () => makeNote({ id: "n1", type: "todo", updatedAt: 999, items: [newItem] }),
    });
    await store.addItem("n1", "新事项");
    expect(invokeMock).toHaveBeenCalledWith("add_todo_item", { noteId: "n1", text: "新事项" });
    expect(store.find("n1")?.items).toHaveLength(1);
    expect(store.find("n1")?.updatedAt).toBe(999);
  });

  it("removeItem 调用 invoke 并从笔记中移除", async () => {
    const store = useNotesStore();
    store.notes = [
      makeNote({
        id: "n1",
        type: "todo",
        items: [{ id: "i1", noteId: "n1", text: "a", checked: false, sortOrder: 0, updatedAt: 0, remindAt: null }],
      }),
    ];
    mockInvoke({
      delete_todo_item: () => null,
      get_note: () => makeNote({ id: "n1", type: "todo" }),
    });
    await store.removeItem("n1", "i1");
    expect(store.find("n1")?.items).toHaveLength(0);
  });

  it("setReminder 调用 set_todo_reminder 并替换对应项数据", async () => {
    const store = useNotesStore();
    store.notes = [
      makeNote({
        id: "n1",
        type: "todo",
        items: [{ id: "i1", noteId: "n1", text: "a", checked: false, sortOrder: 0, updatedAt: 0, remindAt: null }],
      }),
    ];
    mockInvoke({
      set_todo_reminder: () => ({ id: "i1", noteId: "n1", text: "a", checked: false, sortOrder: 0, updatedAt: 1, remindAt: 123 }),
      get_note: () =>
        makeNote({
          id: "n1",
          type: "todo",
          updatedAt: 999,
          items: [{ id: "i1", noteId: "n1", text: "a", checked: false, sortOrder: 0, updatedAt: 1, remindAt: 123 }],
        }),
    });
    await store.setReminder("n1", "i1", 123);
    expect(invokeMock).toHaveBeenCalledWith("set_todo_reminder", { id: "i1", remindAt: 123 });
    expect(store.find("n1")?.items[0].remindAt).toBe(123);
    expect(store.find("n1")?.updatedAt).toBe(999);
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
        remindAt: null,
      })),
    });
  }

  it("勾选补齐最后一项(≥2 项)时触发 celebrateAllDone", async () => {
    const store = useNotesStore();
    store.notes = [todoNote([{ id: "i1", checked: true }, { id: "i2", checked: false }])];
    mockInvoke({
      update_todo_item: () => ({ id: "i2", noteId: "n1", text: "t1", checked: true, sortOrder: 1, updatedAt: 9 }),
      get_note: () => makeNote({ id: "n1", type: "todo", updatedAt: 999 }),
    });
    await store.updateItem("n1", "i2", { checked: true });
    expect(celebrateMock).toHaveBeenCalledTimes(1);
  });

  it("仅剩 1 项待办全部完成时不触发(阈值保护)", async () => {
    const store = useNotesStore();
    store.notes = [todoNote([{ id: "i1", checked: false }])];
    mockInvoke({
      update_todo_item: () => ({ id: "i1", noteId: "n1", text: "t0", checked: true, sortOrder: 0, updatedAt: 9 }),
      get_note: () => makeNote({ id: "n1", type: "todo", updatedAt: 999 }),
    });
    await store.updateItem("n1", "i1", { checked: true });
    expect(celebrateMock).not.toHaveBeenCalled();
  });

  it("取消勾选不触发", async () => {
    const store = useNotesStore();
    store.notes = [todoNote([{ id: "i1", checked: true }, { id: "i2", checked: true }])];
    mockInvoke({
      update_todo_item: () => ({ id: "i2", noteId: "n1", text: "t1", checked: false, sortOrder: 1, updatedAt: 9 }),
      get_note: () => makeNote({ id: "n1", type: "todo", updatedAt: 999 }),
    });
    await store.updateItem("n1", "i2", { checked: false });
    expect(celebrateMock).not.toHaveBeenCalled();
  });

  it("还有未完成项时不触发", async () => {
    const store = useNotesStore();
    store.notes = [todoNote([{ id: "i1", checked: false }, { id: "i2", checked: false }])];
    mockInvoke({
      update_todo_item: () => ({ id: "i1", noteId: "n1", text: "t0", checked: true, sortOrder: 0, updatedAt: 9 }),
      get_note: () => makeNote({ id: "n1", type: "todo", updatedAt: 999 }),
    });
    await store.updateItem("n1", "i1", { checked: true });
    expect(celebrateMock).not.toHaveBeenCalled();
  });

  it("勾选待办后补拉笔记,updatedAt 刷新(卡片时间显示为刚刚)", async () => {
    const store = useNotesStore();
    store.notes = [todoNote([{ id: "i1", checked: false }])];
    mockInvoke({
      update_todo_item: () => ({ id: "i1", noteId: "n1", text: "t0", checked: true, sortOrder: 0, updatedAt: 9 }),
      get_note: () => makeNote({ id: "n1", type: "todo", updatedAt: 999 }),
    });
    await store.updateItem("n1", "i1", { checked: true });
    expect(store.find("n1")?.updatedAt).toBe(999);
  });
});
