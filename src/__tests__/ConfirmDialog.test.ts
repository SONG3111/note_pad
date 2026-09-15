import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mount, enableAutoUnmount } from "@vue/test-utils";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import i18n from "../i18n";

// 回归:本组件常驻挂载(仅用 open 控制显隐),旧实现关闭态也响应 Escape,
// 且打开态的 Escape 会继续触发后注册的其他 window 级 Escape 处理器
// (便签窗口关窗/编辑器关闭),把"取消对话框"放大成"关掉整个窗口"。

// 组件在 window 上挂 keydown 监听,用例间必须卸载
enableAutoUnmount(afterEach);

beforeEach(() => {
  i18n.global.locale.value = "zh-CN";
});

function mountDialog(open: boolean) {
  return mount(ConfirmDialog, {
    props: { open, message: "确定删除吗?" },
    global: { plugins: [i18n] },
  });
}

describe("ConfirmDialog Escape 处理", () => {
  it("打开时 Escape 发出 cancel,且阻止事件继续传给后注册的 Escape 处理器", async () => {
    const wrapper = mountDialog(true);
    // 模拟"确认框之后才注册"的其他 Escape 处理器(如便签窗口的关窗逻辑)
    const later = vi.fn();
    window.addEventListener("keydown", later);
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await Promise.resolve();
      expect(wrapper.emitted("cancel")).toHaveLength(1);
      expect(later).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", later);
    }
  });

  it("关闭时 Escape 不响应(常驻挂载的监听器不再发幽灵 cancel)", async () => {
    const wrapper = mountDialog(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await Promise.resolve();
    expect(wrapper.emitted("cancel")).toBeUndefined();
  });

  it("打开时非 Escape 按键不触发 cancel", async () => {
    const wrapper = mountDialog(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await Promise.resolve();
    expect(wrapper.emitted("cancel")).toBeUndefined();
  });
});
