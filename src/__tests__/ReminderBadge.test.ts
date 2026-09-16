import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ReminderBadge from "../components/ReminderBadge.vue";
import i18n from "../i18n";
import { appLocale } from "../composables/useLocale";

// 待办文字下方的提醒时间小字行(Things 3 式第二行):零横向占位,悬停显示完整时间

// 中文/全角字符:en-US 渲染文本中出现任何一个都算泄漏
const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

function mountBadge(remindAt: number, locale: "zh-CN" | "en-US" = "zh-CN") {
  i18n.global.locale.value = locale;
  appLocale.value = locale;
  return mount(ReminderBadge, {
    props: { remindAt },
    global: { plugins: [i18n] },
  });
}

describe("ReminderBadge", () => {
  it("今天的提醒只显示时间,悬停 title 为完整文案", () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 30).getTime();
    const wrapper = mountBadge(today);
    expect(wrapper.find(".rb-time").text()).toBe("14:30");
    expect(wrapper.find(".reminder-badge").attributes("title")).toContain("14:30");
    expect(wrapper.find(".reminder-badge").attributes("title")).toContain("提醒时间");
  });

  it("非今天的提醒显示日期+时间(9/11 2:30 PM)", () => {
    const ts = new Date(2026, 8, 11, 14, 30).getTime();
    const wrapper = mountBadge(ts, "en-US");
    expect(wrapper.find(".rb-time").text()).toMatch(/^9\/11 \d{1,2}:\d{2} [AP]M$/);
    expect(CJK.test(wrapper.text())).toBe(false);
  });

  it("中文非今天显示 9月11日 14:30", () => {
    const ts = new Date(2026, 8, 11, 14, 30).getTime();
    expect(mountBadge(ts).find(".rb-time").text()).toBe("9月11日 14:30");
  });
});
