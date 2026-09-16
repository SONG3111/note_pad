import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { createPinia } from "pinia";
import NoteWindowApp from "../NoteWindowApp.vue";
import i18n from "../i18n";
import type { NoteWithItems } from "../types";

// 组件在 window 上挂 keydown 监听,用例间必须卸载,否则残留实例会响应后续用例的按键
enableAutoUnmount(afterEach);

// 回归覆盖(独立便签窗口):
// 1) 保存 IPC 在途(dirty 已置回 false)时,跨窗口 notes-changed 不再把
//    用户刚输入、尚未落库的标题覆盖回旧值;
// 2) 系统关闭路径(Alt+F4/任务栏)经 onCloseRequested 先保存再 destroy,
//    旧实现 webview 直接销毁,防抖中的输入丢失;
// 3) 删除确认框打开时 Escape 只取消对话框,不把整个窗口关掉。

type CloseHandler = (e: { preventDefault: () => void }) => Promise<void> | void;
type ChangedHandler = (e: { payload: { id: string; source: string } }) => void;

// vi.mock 工厂与模块顶层 import 同步执行,共享状态须经 vi.hoisted 建立
const shared = vi.hoisted(() => {
  return {
    invokeMock: vi.fn(),
    celebrateMock: vi.fn(),
    destroyMock: vi.fn(),
    closeHandler: null as CloseHandler | null,
    changedHandler: null as ChangedHandler | null,
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: shared.invokeMock }));
vi.mock("../celebrate", () => ({ celebrateAllDone: shared.celebrateMock }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "note-n1",
    setTitle: () => Promise.resolve(),
    destroy: shared.destroyMock,
    onCloseRequested: async (h: CloseHandler) => {
      shared.closeHandler = h;
      return () => {};
    },
    // 提醒选择器 popup 模式挂载/点击时使用
    scaleFactor: () => Promise.resolve(1),
    outerPosition: () => Promise.resolve({ x: 0, y: 0 }),
    onMoved: async () => () => {},
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (ev: string, h: ChangedHandler) => {
    if (ev === "notes-changed") shared.changedHandler = h;
    return () => {};
  },
  emit: async () => {},
}));

function makeNote(partial: Partial<NoteWithItems> = {}): NoteWithItems {
  return {
    id: "n1",
    type: "todo",
    title: "原标题",
    content: null,
    color: null,
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
    items: [
      { id: "i1", noteId: "n1", text: "事项", checked: false, sortOrder: 0, updatedAt: 1, remindAt: null },
    ],
    ...partial,
  };
}

function mountWindow() {
  return mount(NoteWindowApp, { global: { plugins: [i18n, createPinia()] } });
}

beforeEach(() => {
  shared.invokeMock.mockReset().mockImplementation((cmd: string) => {
    if (cmd === "get_note") return Promise.resolve(makeNote());
    return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
  });
  shared.celebrateMock.mockReset();
  shared.destroyMock.mockReset().mockResolvedValue(undefined);
  shared.closeHandler = null;
  shared.changedHandler = null;
  i18n.global.locale.value = "zh-CN";
});

describe("NoteWindowApp 保存与跨窗口同步", () => {
  it("保存 IPC 在途时,远端变更事件不覆盖本地未落库的输入", async () => {
    const wrapper = mountWindow();
    await flushPromises();

    await wrapper.find(".title-input").setValue("新标题");
    // 防抖到期触发保存;update_note 永不落地,保持"在途"状态
    shared.invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_note") return Promise.resolve(makeNote());
      if (cmd === "update_note") return new Promise(() => {});
      return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    });
    await vi.waitFor(
      () => expect(shared.invokeMock).toHaveBeenCalledWith("update_note", expect.anything()),
      { timeout: 3000 },
    );

    // 保存已在途(dirty=false、saving=true):此刻其他窗口的变更不得回拉覆盖
    shared.changedHandler!({ payload: { id: "n1", source: "main" } });
    await flushPromises();
    expect((wrapper.find(".title-input").element as HTMLInputElement).value).toBe("新标题");
  });

  it("无关笔记的变更事件不触发回拉", async () => {
    mountWindow();
    await flushPromises();
    shared.invokeMock.mockClear();
    shared.changedHandler!({ payload: { id: "other-note", source: "main" } });
    await flushPromises();
    expect(shared.invokeMock).not.toHaveBeenCalled();
  });
});

describe("NoteWindowApp 系统关闭路径", () => {
  it("Alt+F4 触发的关闭:阻止默认销毁,先保存再 destroy", async () => {
    const wrapper = mountWindow();
    await flushPromises();

    await wrapper.find(".title-input").setValue("改过的标题");
    let resolveUpdate!: (v: NoteWithItems) => void;
    shared.invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_note") return Promise.resolve(makeNote());
      if (cmd === "update_note")
        return new Promise<NoteWithItems>((r) => (resolveUpdate = r));
      return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    });

    expect(shared.closeHandler).not.toBeNull();
    const preventDefault = vi.fn();
    const closing = shared.closeHandler!({ preventDefault });
    await flushPromises();
    expect(preventDefault).toHaveBeenCalled();
    expect(shared.invokeMock).toHaveBeenCalledWith(
      "update_note",
      expect.objectContaining({ id: "n1" }),
    );
    // 保存未完成前不得销毁窗口
    expect(shared.destroyMock).not.toHaveBeenCalled();

    resolveUpdate(makeNote({ title: "改过的标题" }));
    await closing;
    expect(shared.destroyMock).toHaveBeenCalledTimes(1);
  });
});

describe("NoteWindowApp Escape 与删除确认框", () => {
  it("确认框打开时 Escape 只取消对话框,窗口不被关闭", async () => {
    const wrapper = mountWindow();
    await flushPromises();

    await wrapper.find(".tool-btn.danger").trigger("click");
    // 确认框经 Teleport 挂在 body 下,须从 document 查询
    expect(document.querySelector(".overlay")).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(document.querySelector(".overlay")).toBeNull();
    expect(shared.destroyMock).not.toHaveBeenCalled();
  });
});

describe("NoteWindowApp 待办文本失焦", () => {
  it("清空文本后失焦:输入框还原为现值,不发写请求", async () => {
    const wrapper = mountWindow();
    await flushPromises();
    shared.invokeMock.mockClear();

    const input = wrapper.find(".item-text");
    await input.setValue("");
    await input.trigger("blur");
    expect((input.element as HTMLInputElement).value).toBe("事项");
    expect(shared.invokeMock).not.toHaveBeenCalledWith("update_todo_item", expect.anything());
  });
});
