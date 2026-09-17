import { beforeEach, afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
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
type MovedHandler = () => void;

// vi.mock 工厂与模块顶层 import 同步执行,共享状态须经 vi.hoisted 建立
const shared = vi.hoisted(() => {
  return {
    invokeMock: vi.fn(),
    celebrateMock: vi.fn(),
    destroyMock: vi.fn(),
    showMock: vi.fn(),
    closeHandler: null as CloseHandler | null,
    changedHandler: null as ChangedHandler | null,
    // 真实 Tauri 支持同一窗口多个 onMoved 监听(NoteWindowApp 的停靠注册、
    // ReminderPicker 的关弹窗清扫各自注册),mock 用数组完整建模
    movedHandlers: [] as MovedHandler[],
    // 已落定的 onMoved 注销句柄被调用的次数(卸载清理回归用)
    movedUnlistenCalls: 0,
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: shared.invokeMock }));
vi.mock("../celebrate", () => ({ celebrateAllDone: shared.celebrateMock }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "note-n1",
    setTitle: () => Promise.resolve(),
    // 窗口隐身创建,首帧绘制(nextTick+双 rAF)后才由前端 show+setFocus(见 onMounted)
    show: (...args: unknown[]) => shared.showMock(...args),
    setFocus: () => Promise.resolve(),
    destroy: shared.destroyMock,
    onCloseRequested: async (h: CloseHandler) => {
      shared.closeHandler = h;
      return () => {};
    },
    // 提醒选择器 popup 模式挂载/点击时使用
    scaleFactor: () => Promise.resolve(1),
    innerPosition: () => Promise.resolve({ x: 0, y: 0 }),
    outerPosition: () => Promise.resolve({ x: 0, y: 0 }),
    onMoved: async (h: MovedHandler) => {
      shared.movedHandlers.push(h);
      return () => {
        shared.movedUnlistenCalls += 1;
      };
    },
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

// 双 rAF 桩:onMounted 等"首帧绘制"(nextTick+双 rAF)后才 show 并注册
// notes-changed/onCloseRequested/onMoved 监听,真实环境的 rAF 是定时器回调,
// flushPromises 等不到——桩成微任务回调,链路在 flushPromises 内确定性完成,
// 也避免挂载残留到后续用例。计数供入场用例断言 show 前已经过的渲染帧数
let rafCount = 0;
let rafAtShow = -1;
let rafSpy: MockInstance | undefined;

beforeEach(() => {
  shared.invokeMock.mockReset().mockImplementation((cmd: string) => {
    if (cmd === "get_note") return Promise.resolve(makeNote());
    return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
  });
  shared.celebrateMock.mockReset();
  shared.destroyMock.mockReset().mockResolvedValue(undefined);
  shared.showMock.mockReset().mockResolvedValue(undefined);
  shared.closeHandler = null;
  shared.changedHandler = null;
  shared.movedHandlers = [];
  shared.movedUnlistenCalls = 0;
  i18n.global.locale.value = "zh-CN";
  rafCount = 0;
  rafAtShow = -1;
  rafSpy = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb: FrameRequestCallback) => {
      rafCount += 1;
      queueMicrotask(() => cb(performance.now()));
      return rafCount;
    });
  shared.showMock.mockImplementation(() => {
    rafAtShow = rafCount;
    return Promise.resolve();
  });
});

afterEach(() => {
  rafSpy?.mockRestore();
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

describe("NoteWindowApp 拖出入场", () => {
  it("窗口等首帧绘制完成(双 rAF)才 show,且不再有整窗透明占位/淡入", async () => {
    const wrapper = mountWindow();
    await flushPromises();
    expect(shared.showMock).toHaveBeenCalledTimes(1);
    // 白闪回归:此前 applyLoaded 一返回就 show(DOM 未提交、首帧未合成),
    // 窗口先以空白态闪现;现在 show 前必须经过 nextTick + 双渲染帧
    expect(rafAtShow).toBeGreaterThanOrEqual(2);
    // 交接只留主窗口纸片淡出一个事件,窗口自身无入场类
    expect(wrapper.find(".nwin").classes().join(" ")).not.toMatch(/nwin-pre|nwin-in/);
  });
});

describe("NoteWindowApp 停靠注册", () => {
  it("首次被拖动(窗口移动)时注册进停靠管理,且只注册一次", async () => {
    mountWindow();
    await flushPromises();
    shared.invokeMock.mockClear();
    expect(shared.movedHandlers.length).toBeGreaterThanOrEqual(2); // 停靠注册 + 提醒选择器清扫

    shared.movedHandlers.forEach((h) => h());
    shared.movedHandlers.forEach((h) => h());
    await flushPromises();
    // 移动事件同时会触发提醒选择器的关弹窗清扫;停靠注册请求本身只发一次
    const registerCalls = shared.invokeMock.mock.calls.filter(([c]) => c === "register_note_dock");
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0]).toEqual(["register_note_dock", { label: "note-n1" }]);
  });

  it("卸载时注销全部 onMoved 监听,且异步挂载后不再触发 Vue 生命周期警告", async () => {
    // 回归:清理钩子曾写在异步 onMounted 的 await 之后,组件实例已失联,
    // 钩子永远不会注册——监听器从不注销,且每次挂载都报
    // "onBeforeUnmount is called when there is no active component instance" 警告
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const wrapper = mountWindow();
      await flushPromises();
      // 挂载完成:停靠注册(NoteWindowApp)+ 弹窗清扫(ReminderPicker)两个监听都已落定
      expect(shared.movedHandlers.length).toBe(2);

      wrapper.unmount();
      // 两个监听都必须被注销:停靠注册由组件卸载钩子、清扫由 ReminderPicker 卸载钩子
      expect(shared.movedUnlistenCalls).toBe(2);
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("onBeforeUnmount is called"),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
