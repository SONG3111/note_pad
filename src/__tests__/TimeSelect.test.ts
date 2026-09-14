import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TimeSelect from "../components/TimeSelect.vue";
import i18n from "../i18n";

// 时/分步进选择器:数字输入 + 上下箭头(替代旧的弹出滚动列表——列表在小窗口会被截断)

beforeEach(() => {
  i18n.global.locale.value = "zh-CN";
});

function mountSelect(modelValue: number, max: number) {
  return mount(TimeSelect, {
    props: { modelValue, max, ariaLabel: "小时" },
    global: { plugins: [i18n] },
  });
}

describe("TimeSelect", () => {
  it("显示补零的当前值,spinbutton 无障碍属性齐全", () => {
    const wrapper = mountSelect(9, 23);
    const input = wrapper.find(".ts-input");
    expect((input.element as HTMLInputElement).value).toBe("09");
    expect(input.attributes("role")).toBe("spinbutton");
    expect(input.attributes("aria-valuemin")).toBe("0");
    expect(input.attributes("aria-valuemax")).toBe("23");
    expect(input.attributes("aria-valuenow")).toBe("9");
    expect(mountSelect(0, 59).find(".ts-input").element as HTMLInputElement).toBeTruthy();
  });

  it("键入合法值后回车提交 update:modelValue", async () => {
    const wrapper = mountSelect(9, 23);
    const input = wrapper.find(".ts-input");
    await input.setValue("10");
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted<[number]>("update:modelValue")).toEqual([[10]]);
  });

  it("失焦时也提交;超出上限钳制到 max", async () => {
    const wrapper = mountSelect(9, 23);
    const input = wrapper.find(".ts-input");
    await input.setValue("99");
    await input.trigger("blur");
    expect(wrapper.emitted<[number]>("update:modelValue")).toEqual([[23]]);
  });

  it("空输入或非数字不提交,还原当前值", async () => {
    const wrapper = mountSelect(9, 23);
    const input = wrapper.find(".ts-input");
    await input.setValue("");
    await input.trigger("blur");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect((wrapper.find(".ts-input").element as HTMLInputElement).value).toBe("09");

    await input.setValue("abc");
    await input.trigger("blur");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("编辑期间逐键不提交,回车才提交一次", async () => {
    const wrapper = mountSelect(9, 23);
    const input = wrapper.find(".ts-input");
    await input.setValue("1");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await input.setValue("12");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted<[number]>("update:modelValue")).toEqual([[12]]);
  });

  it("点击上/下箭头单步增减并首尾回绕", async () => {
    const top = mountSelect(23, 23);
    await top.find(".ts-step").trigger("click");
    expect(top.emitted<[number]>("update:modelValue")![0]).toEqual([0]);

    const bottom = mountSelect(0, 23);
    await bottom.findAll(".ts-step")[1]!.trigger("click");
    expect(bottom.emitted<[number]>("update:modelValue")![0]).toEqual([23]);
  });

  it("输入框聚焦时 ↑↓ 键增减,Esc 放弃编辑还原当前值", async () => {
    const wrapper = mountSelect(9, 23);
    const input = wrapper.find(".ts-input");
    await input.trigger("keydown", { key: "ArrowUp" });
    expect(wrapper.emitted<[number]>("update:modelValue")![0]).toEqual([10]);
    // 组件无父级时 props 不回写,仍以初始值 9 计算向下步进
    await input.trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.emitted<[number]>("update:modelValue")![1]).toEqual([8]);

    await input.setValue("7");
    await input.trigger("keydown", { key: "Escape" });
    await input.trigger("blur");
    expect(wrapper.emitted("update:modelValue")).toHaveLength(2);
    expect((wrapper.find(".ts-input").element as HTMLInputElement).value).toBe("09");
  });

  // 回归:聚焦期间草稿仍在会让键盘步进"看似无效并被失焦还原"
  it("聚焦编辑中按 ↑↓ 步进:显示跟随新值,失焦不把旧草稿提交回去", async () => {
    const wrapper = mountSelect(9, 23);
    const input = wrapper.find(".ts-input");
    await input.trigger("focus"); // 进入编辑,草稿 = "9"
    await input.trigger("keydown", { key: "ArrowUp" }); // 发出 10
    await wrapper.setProps({ modelValue: 10 });
    expect((input.element as HTMLInputElement).value).toBe("10");
    await input.trigger("blur"); // 修复前:把旧草稿 9 提交回去
    expect(wrapper.emitted<[number]>("update:modelValue")).toHaveLength(1);
    expect((wrapper.find(".ts-input").element as HTMLInputElement).value).toBe("10");
  });
});
