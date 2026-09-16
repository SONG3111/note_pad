import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import ReminderPopupApp from "../ReminderPopupApp.vue";
import i18n from "../i18n";
import type { TodoItem } from "../types";

// 提醒选择弹窗小窗(label = reminder-pop-<itemId>)的行为:
// 加载目标待办项初始化面板;选择直接走 set_todo_reminder(跨窗口同步由后端广播);
// 失焦/Escape/项被删除时自毁。

enableAutoUnmount(afterEach);

type FocusHandler = (e: { payload: boolean }) => void;

const shared = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  destroyMock: vi.fn(),
  focusHandler: null as FocusHandler | null,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: shared.invokeMock }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "reminder-pop-i1",
    destroy: shared.destroyMock,
    onFocusChanged: async (h: FocusHandler) => {
      shared.focusHandler = h;
      return () => {};
    },
  }),
}));

function makeItem(remindAt: number | null = null): TodoItem {
  return {
    id: "i1",
    noteId: "n1",
    text: "事项",
    checked: false,
    sortOrder: 0,
    updatedAt: 1,
    remindAt,
  };
}

function mountPopup() {
  return mount(ReminderPopupApp, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  shared.invokeMock.mockReset().mockImplementation((cmd: string) => {
    if (cmd === "get_todo_item") return Promise.resolve(makeItem(123_456));
    return Promise.resolve(makeItem());
  });
  shared.destroyMock.mockReset().mockResolvedValue(undefined);
  shared.focusHandler = null;
  i18n.global.locale.value = "zh-CN";
});

describe("ReminderPopupApp 初始化", () => {
  it("按 label 解析待办项并渲染面板", async () => {
    const wrapper = mountPopup();
    await flushPromises();
    expect(shared.invokeMock).toHaveBeenCalledWith("get_todo_item", { id: "i1" });
    expect(wrapper.find(".rp-panel").exists()).toBe(true);
    expect(shared.destroyMock).not.toHaveBeenCalled();
  });

  it("项已被删除(ITEM_NOT_FOUND):弹窗自关", async () => {
    shared.invokeMock.mockRejectedValue("ITEM_NOT_FOUND");
    mountPopup();
    await flushPromises();
    expect(shared.destroyMock).toHaveBeenCalledTimes(1);
  });
});

describe("ReminderPopupApp 选择与清除", () => {
  it("点今天的日期提交 set_todo_reminder,窗口保留便于微调", async () => {
    // remindAt 未设:面板初始视图落在当前月,今天可选
    shared.invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_todo_item") return Promise.resolve(makeItem(null));
      return Promise.resolve(makeItem());
    });
    const wrapper = mountPopup();
    await flushPromises();
    await wrapper.find(".cal-day.today").trigger("click");
    await flushPromises();
    expect(shared.invokeMock).toHaveBeenCalledWith(
      "set_todo_reminder",
      expect.objectContaining({ id: "i1" }),
    );
    expect(shared.destroyMock).not.toHaveBeenCalled();
  });

  it("清除提醒:写空值后关窗", async () => {
    const wrapper = mountPopup();
    await flushPromises();
    await wrapper.find(".rp-clear").trigger("click");
    await flushPromises();
    expect(shared.invokeMock).toHaveBeenCalledWith("set_todo_reminder", {
      id: "i1",
      remindAt: null,
    });
    expect(shared.destroyMock).toHaveBeenCalledTimes(1);
  });

  it("设置失败(项被勾选/删除):关窗不残留", async () => {
    shared.invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_todo_item") return Promise.resolve(makeItem(null));
      return Promise.reject("ITEM_CHECKED");
    });
    const wrapper = mountPopup();
    await flushPromises();
    await wrapper.find(".cal-day.today").trigger("click");
    await flushPromises();
    expect(shared.destroyMock).toHaveBeenCalledTimes(1);
  });
});

describe("ReminderPopupApp 自关", () => {
  it("窗口失焦(点击其他窗口)即关闭", async () => {
    mountPopup();
    await flushPromises();
    expect(shared.focusHandler).not.toBeNull();
    shared.focusHandler!({ payload: false });
    await flushPromises();
    expect(shared.destroyMock).toHaveBeenCalledTimes(1);
  });

  it("Escape 关闭", async () => {
    mountPopup();
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(shared.destroyMock).toHaveBeenCalledTimes(1);
  });

  it("获得焦点不关闭", async () => {
    mountPopup();
    await flushPromises();
    shared.focusHandler!({ payload: true });
    await flushPromises();
    expect(shared.destroyMock).not.toHaveBeenCalled();
  });
});
