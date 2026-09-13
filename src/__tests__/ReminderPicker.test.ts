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
    // 时/分是步进输入框:键入 10 后回车提交
    const hourInput = wrapper.find(".rp-time-row .ts-input");
    await hourInput.setValue("10");
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

  it("向上弹出时面板底部与铃铛的间距和向下弹一致(6px)", async () => {
    // 铃铛贴近视口底部触发向上翻转;面板实测高度 300(jsdom 无布局,mock offsetHeight)
    const PANEL_H = 300;
    const rect = { top: 600, bottom: 622, right: 300 } as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    const heightSpy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(PANEL_H);
    try {
      const wrapper = mountPicker();
      await openPanel(wrapper);
      const panel = wrapper.find(".rp-panel");
      const top = Number.parseFloat((panel.element as HTMLElement).style.top);
      // 向上弹的间距 = rect.top - (top + 面板高度) == 6,与向下弹的 rect.bottom + 6 对称
      expect(Math.round(rect.top - (top + PANEL_H))).toBe(6);
    } finally {
      heightSpy.mockRestore();
      vi.restoreAllMocks();
    }
  });
});
