import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReminderPicker from "../components/ReminderPicker.vue";
import i18n from "../i18n";
import { appLocale } from "../composables/useLocale";

// 回归覆盖:提醒面板曾用原生 datetime-local,其格式与日历弹层跟随 WebView 系统语言,
// 中文系统开英文界面会漏出中文。自绘面板(月历+时分下拉)必须完全按应用语言渲染。

// 中文/全角字符(含中文标点):en-US 面板文本中出现任何一个都算泄漏
const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

function mountPicker(remindAt: number | null = null) {
  return mount(ReminderPicker, {
    global: { plugins: [i18n] },
    props: { remindAt },
  });
}

async function openPanel(wrapper: ReturnType<typeof mountPicker>) {
  await wrapper.find(".rp-btn").trigger("click");
  await vi.waitFor(() => {
    expect(wrapper.find(".rp-panel").exists()).toBe(true);
    expect(wrapper.find(".cal-grid").exists()).toBe(true);
  });
}

beforeEach(() => {
  // 每个用例显式设定语言,避免全局 i18n 单例在用例间串味;
  // 与生产 applyLocale 一致:i18n locale 与 appLocale 同时设置
  i18n.global.locale.value = "zh-CN";
  appLocale.value = "zh-CN";
});

describe("ReminderPicker 双语渲染", () => {
  it("中文模式:面板显示中文星期表头与中文月份标题", async () => {
    const wrapper = mountPicker();
    await openPanel(wrapper);
    expect(wrapper.find(".cal-month").text()).toMatch(/^\d{4}年\d{1,2}月$/);
    expect(wrapper.find(".rp-panel").text()).toContain("自定义时间");
  });

  it("英文模式:面板全部为英文,不含任何中文字符", async () => {
    i18n.global.locale.value = "en-US";
    appLocale.value = "en-US";
    const wrapper = mountPicker();
    await openPanel(wrapper);
    const text = wrapper.find(".rp-panel").text();
    expect(wrapper.find(".cal-month").text()).toMatch(/^[A-Z][a-z]+ \d{4}$/);
    expect(text).toContain("Mo");
    expect(text).toContain("Custom time");
    expect(CJK.test(text)).toBe(false);
  });

  it("英文模式:面板与清除按钮也是英文(时间标签已移至 ReminderBadge)", async () => {
    i18n.global.locale.value = "en-US";
    appLocale.value = "en-US";
    const wrapper = mountPicker(Date.now() + 3_600_000);
    await openPanel(wrapper);
    expect(wrapper.find(".rp-time").exists()).toBe(false);
    // 清除提醒是标题行右端的文字按钮
    expect(wrapper.find(".rp-panel").text()).toContain("Clear reminder");
    expect(CJK.test(wrapper.find(".rp-panel").text())).toBe(false);
  });
});

describe("ReminderPicker 交互", () => {
  it("默认收起,点击铃铛展开,再点收起", async () => {
    const wrapper = mountPicker();
    expect(wrapper.find(".rp-panel").exists()).toBe(false);
    await wrapper.find(".rp-btn").trigger("click");
    expect(wrapper.find(".rp-panel").exists()).toBe(true);
    await wrapper.find(".rp-btn").trigger("click");
    expect(wrapper.find(".rp-panel").exists()).toBe(false);
  });

  it("过去的日期禁选(早于今天的格子均带 disabled)", async () => {
    const wrapper = mountPicker();
    await openPanel(wrapper);
    const disabled = wrapper.findAll(".cal-day[disabled]");
    expect(disabled.length).toBeGreaterThan(0);
  });

  it("点击今天的日期发出 set 事件,时间戳指向未来", async () => {
    const wrapper = mountPicker();
    await openPanel(wrapper);
    await wrapper.find(".cal-day.today").trigger("click");
    const events = wrapper.emitted<[number]>("set");
    expect(events).toHaveLength(1);
    expect(events![0][0]).toBeGreaterThan(Date.now());
  });

  it("更改小时提交新提醒且不关面板(便于继续微调)", async () => {
    const wrapper = mountPicker();
    await openPanel(wrapper);
    // 初始小时 = 当前时间+1 小时,目标值取与其必不相同的小时(避免时间依赖的偶发失败)
    const initialHour = new Date(Date.now() + 3_600_000).getHours();
    const target = (initialHour + 7) % 24;
    // 时/分是步进输入框:键入目标小时后回车提交
    const hourInput = wrapper.find(".rp-time-row .ts-input");
    await hourInput.setValue(String(target));
    await hourInput.trigger("keydown", { key: "Enter" });
    const events = wrapper.emitted<[number]>("set");
    expect(events).toHaveLength(1);
    expect(events![0][0]).toBeGreaterThan(Date.now());
    expect(wrapper.find(".rp-panel").exists()).toBe(true);
  });

  it("已设提醒时清除按钮发出 set(null) 并收起", async () => {
    const wrapper = mountPicker(Date.now() + 3_600_000);
    await openPanel(wrapper);
    await wrapper.find(".rp-clear").trigger("click");
    expect(wrapper.emitted("set")![0]).toEqual([null]);
    expect(wrapper.find(".rp-panel").exists()).toBe(false);
  });

  it("选择当前分钟(已部分过去)保留精确时刻,不被静默 +60 秒", async () => {
    // 回归:连续给多项设同一时刻时,晚提交的一项曾因 ts <= now 被钳到 +60s,与其他项错开约一分钟
    const wrapper = mountPicker();
    await openPanel(wrapper);
    await wrapper.find(".cal-day.today").trigger("click");
    const now = new Date();
    const inputs = wrapper.findAll(".rp-time-row .ts-input");
    await inputs[0].setValue(String(now.getHours()));
    await inputs[0].trigger("keydown", { key: "Enter" });
    await inputs[1].setValue(String(now.getMinutes()));
    await inputs[1].trigger("keydown", { key: "Enter" });

    const events = wrapper.emitted<[number]>("set")!;
    const payload = events[events.length - 1][0];
    // 提交期间跨分钟(偶发)时组件会按新当前分钟钳制,跳过精确断言避免时间依赖的偶发失败
    if (new Date().getMinutes() === now.getMinutes()) {
      expect(payload).toBe(new Date(now).setSeconds(0, 0));
    }
  });

  it("选择上一分钟(真正错过)仍钳到提交时刻的约 1 分钟后", async () => {
    const wrapper = mountPicker();
    await openPanel(wrapper);
    await wrapper.find(".cal-day.today").trigger("click");
    const before = Date.now();
    const prev = new Date(new Date(before).setSeconds(0, 0) - 60_000);
    const inputs = wrapper.findAll(".rp-time-row .ts-input");
    await inputs[0].setValue(String(prev.getHours()));
    await inputs[0].trigger("keydown", { key: "Enter" });
    await inputs[1].setValue(String(prev.getMinutes()));
    await inputs[1].trigger("keydown", { key: "Enter" });

    const events = wrapper.emitted<[number]>("set")!;
    const payload = events[events.length - 1][0];
    // 整分钟前的一刻必然触发钳制:结果落在 [提交前时刻+60s, 断言时时刻+60s] 区间内
    expect(payload).toBeGreaterThanOrEqual(before + 60_000);
    expect(payload).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("向上弹出时面板底部与铃铛的间距和向下弹一致(6px)", async () => {
    // 铃铛贴近视口底部触发向上翻转;面板实测高度 300(jsdom 无布局,mock offsetHeight)
    const PANEL_H = 300;
    const rect = { top: 600, bottom: 622, right: 300 } as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    const heightSpy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(PANEL_H);
    try {
      const wrapper = mountPicker();
      await openPanel(wrapper);
      // 定位样式在浮层容器上(fixed 定位),视觉卡片是内嵌的 ReminderPanel
      const panel = wrapper.find(".rp-floating");
      const top = Number.parseFloat((panel.element as HTMLElement).style.top);
      // 向上弹的间距 = rect.top - (top + 面板高度) == 6,与向下弹的 rect.bottom + 6 对称
      expect(Math.round(rect.top - (top + PANEL_H))).toBe(6);
    } finally {
      heightSpy.mockRestore();
      vi.restoreAllMocks();
    }
  });
});

describe("ReminderPicker popup 模式(独立便签窗口)", () => {
  // 窗口 mock 的共享捕获:onMoved 回调由组件挂载时注册,用例触发它验证联动关窗
  const shared = vi.hoisted(() => ({
    invokeMock: vi.fn(),
    movedHandler: null as (() => void) | null,
  }));
  vi.mock("@tauri-apps/api/core", () => ({ invoke: shared.invokeMock }));
  vi.mock("@tauri-apps/api/window", () => ({
    getCurrentWindow: () => ({
      label: "note-n1",
      // 2x 缩放 + 内容区原点 (100,200):坐标换算可被精确断言
      scaleFactor: async () => 2,
      innerPosition: async () => ({ x: 100, y: 200 }),
      onMoved: async (h: () => void) => {
        shared.movedHandler = h;
        return () => {};
      },
    }),
  }));

  function mountPopupPicker(itemId = "i1", remindAt: number | null = null) {
    return mount(ReminderPicker, {
      global: { plugins: [i18n] },
      props: { remindAt, mode: "popup", itemId },
    });
  }

  const openCalls = () =>
    shared.invokeMock.mock.calls.filter(([cmd]) => cmd === "open_reminder_popup").length;

  beforeEach(() => {
    shared.invokeMock.mockReset().mockResolvedValue(undefined);
    shared.movedHandler = null;
  });

  it("点击铃铛不渲染本地浮层,而是按内容区原点换算屏幕坐标请求后端建弹窗", async () => {
    const wrapper = mountPopupPicker();
    // 按钮在窗口内容区 (left 20, width 22, bottom 32),物理坐标 = 内容区原点 + 逻辑×2
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 20,
      top: 10,
      right: 42,
      bottom: 32,
      width: 22,
      height: 22,
    } as DOMRect);
    try {
      await wrapper.find(".rp-btn").trigger("click");
      await vi.waitFor(() =>
        expect(shared.invokeMock).toHaveBeenCalledWith("open_reminder_popup", {
          itemId: "i1",
          anchorX: 100 + 31 * 2, // 铃铛中心 x
          anchorY: 200 + 32 * 2, // 铃铛下缘 y
        }),
      );
      expect(wrapper.find(".rp-panel").exists()).toBe(false);
      expect(wrapper.find(".rp-floating").exists()).toBe(false);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("每次点击都请求后端建窗:开/关语义由后端按关闭回声判定,前端不自行拦截", async () => {
    // 回归:弹窗开着时再点铃铛,按下瞬间弹窗已失焦自毁,前端无从得知它曾开着;
    // 任何本地"开关记忆"都会与跨窗口销毁事件赛跑,判定必须放在后端
    const wrapper = mountPopupPicker();
    await wrapper.find(".rp-btn").trigger("click");
    await vi.waitFor(() => expect(openCalls()).toBe(1));
    await wrapper.find(".rp-btn").trigger("click");
    await vi.waitFor(() => expect(openCalls()).toBe(2));
    expect(shared.invokeMock).not.toHaveBeenCalledWith("close_reminder_popups");
    wrapper.unmount();
  });

  it("挂载即监听父窗口移动,窗口被拖动时关闭所有提醒弹窗", async () => {
    const wrapper = mountPopupPicker();
    await vi.waitFor(() => expect(shared.movedHandler).not.toBeNull());
    shared.movedHandler!();
    await vi.waitFor(() =>
      expect(shared.invokeMock).toHaveBeenCalledWith("close_reminder_popups"),
    );
    wrapper.unmount();
  });

  it("panel 模式(默认)不请求后端建窗", async () => {
    const wrapper = mount(ReminderPicker, {
      global: { plugins: [i18n] },
      props: { remindAt: null },
    });
    await openPanel(wrapper);
    expect(shared.invokeMock).not.toHaveBeenCalled();
    expect(wrapper.find(".rp-floating").exists()).toBe(true);
  });
});
