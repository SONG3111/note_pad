import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import TodoCheckbox from "../components/TodoCheckbox.vue";

const { checkSoundMock, uncheckSoundMock, burstMock } = vi.hoisted(() => ({
  checkSoundMock: vi.fn(),
  uncheckSoundMock: vi.fn(),
  burstMock: vi.fn(),
}));
vi.mock("../sound", () => ({
  playCheckSound: checkSoundMock,
  playUncheckSound: uncheckSoundMock,
}));
vi.mock("../burst", () => ({ spawnBurst: burstMock }));

beforeEach(() => {
  checkSoundMock.mockClear();
  uncheckSoundMock.mockClear();
  burstMock.mockClear();
});

describe("TodoCheckbox", () => {
  it("勾选:emit change、播勾选音、在复选盒中心迸发粒子", async () => {
    const wrapper = mount(TodoCheckbox, { props: { checked: false } });
    // setValue 会同时更新 checked 并触发 change 事件,无需再手动 trigger
    const input = wrapper.find("input.cb-input");
    await input.setValue(true);

    expect(wrapper.emitted("change")).toHaveLength(1);
    expect(checkSoundMock).toHaveBeenCalledTimes(1);
    expect(uncheckSoundMock).not.toHaveBeenCalled();
    // getBoundingClientRect 在 jsdom 里全为 0,中心即 (0,0)
    expect(burstMock).toHaveBeenCalledTimes(1);
    expect(burstMock).toHaveBeenCalledWith(0, 0);
  });

  it("取消勾选:emit change、只播取消音,无粒子", async () => {
    const wrapper = mount(TodoCheckbox, { props: { checked: true } });
    const input = wrapper.find("input.cb-input");
    await input.setValue(false);

    expect(wrapper.emitted("change")).toHaveLength(1);
    expect(uncheckSoundMock).toHaveBeenCalledTimes(1);
    expect(checkSoundMock).not.toHaveBeenCalled();
    expect(burstMock).not.toHaveBeenCalled();
  });

  it("受控属性:勾选框状态跟随 props", () => {
    const checked = mount(TodoCheckbox, { props: { checked: true } });
    expect((checked.find("input.cb-input").element as HTMLInputElement).checked).toBe(true);
    const unchecked = mount(TodoCheckbox, { props: { checked: false } });
    expect((unchecked.find("input.cb-input").element as HTMLInputElement).checked).toBe(false);
  });
});
