import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mount, enableAutoUnmount } from "@vue/test-utils";
import { createPinia } from "pinia";
import NoteCard from "../components/NoteCard.vue";
import i18n from "../i18n";
import type { NoteWithItems } from "../types";

// 回归覆盖:"从手账上撕下便签"手势——
// 1) 按住:卡片轻微浮起(lifted)+ 胶带捏住,不产生纸片与折角;
// 2) 拖动(≥10px):原位折角——折痕垂直于拖动方向、1:1 跟手扫进
//    (斜着拖就斜着折);卡片本体沿折痕裁开保留对侧,被抓侧角瓣
//    (Teleport 到 body 的实色纸背,不带字)镜像折回;
//    全程纸不离账,不产生跟手纸片、不变占位;
// 3) 三条撕离路,拖动 ≥45px 即在拖动中自动撕离(纸片从折角状态起飞,
//    卷角 = 拖动距离截断衔接,发出 detach 载荷建窗):
//    a. 折痕线穿过胶带矩形(斜向拖,折痕先到);
//    b. 折面盖过胶带锚点(横向拖,折面先到);
//    c. 向下拉扯(顺胶带粘着方向揭纸,立即撕离);
//    松手早于撕离:折角展开平复,无 detach。
// jsdom 无布局:用统一的 mock rect(200,200,300,200),抓取点据此断言。

enableAutoUnmount(afterEach);

vi.mock("../celebrate", () => ({ celebrateAllDone: vi.fn() }));

// 窗口变换 mock:flyToWindow 用它换算飞入落点(scale=1,窗口原点 1000,500),
// 使撕离链路能走完 IPC+双帧到达 fly 态,落点断言才有确定值
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    scaleFactor: () => Promise.resolve(1),
    innerPosition: () => Promise.resolve({ x: 1000, y: 500 }),
  }),
}));

const RECT = { left: 200, top: 200, width: 300, height: 200, right: 500, bottom: 400 };

function makeNote(): NoteWithItems {
  return {
    id: "n1",
    type: "note",
    title: "测试便签",
    content: "内容",
    color: null,
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
    items: [],
  };
}

function mountCard() {
  return mount(NoteCard, {
    props: { note: makeNote() },
    global: { plugins: [i18n, createPinia()] },
  });
}

function pointer(type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number, target?: EventTarget) {
  (target ?? window).dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }),
  );
}

function ghostEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".detach-ghost");
}

function flapEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".fold-flap");
}

function wrapEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".fold-wrap");
}

beforeEach(() => {
  i18n.global.locale.value = "zh-CN";
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    RECT as DOMRect,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NoteCard 四段式撕纸手势", () => {
  it("按住即浮起:卡片带 lifted,未产生纸片与折角,无 detach", async () => {
    const wrapper = mountCard();
    pointer("pointerdown", 300, 300, wrapper.find(".card").element);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".card").classes()).toContain("lifted");
    expect(ghostEl()).toBeNull();
    expect(flapEl()).toBeNull();
    expect(wrapper.emitted("detach")).toBeUndefined();
  });

  it("拖动(≥10px):折痕垂直于拖动方向斜着扫进,角瓣为实色纸背镜像折回,胶带被拉扯", async () => {
    const wrapper = mountCard();
    const card = wrapper.find(".card");
    pointer("pointerdown", 300, 300, card.element);
    // 斜着拖(Δ=(20,12)):折痕 = 过 P(20,12)、垂直于拖动方向的斜线
    pointer("pointermove", 320, 312, card.element);
    await wrapper.vm.$nextTick();

    const flap = flapEl();
    expect(flap).not.toBeNull();
    // 被抓侧(tl)角瓣 = 折痕切出的角三角(双层:外层反射,内层裁剪)
    expect(flap!.style.clipPath).toBe(
      "polygon(27.2px 0.0px, 0.0px 45.3px, 0.0px 0.0px, 0.0px 0.0px, 0.0px 0.0px, 0.0px 0.0px)",
    );
    // 反射矩阵(外层):斜折痕为轴,角(0,0)折到 C+2Δ=(40,24)
    expect(wrapEl()!.style.transform).toBe("matrix(-0.4706, -0.8824, -0.8824, 0.4706, 40.00, 24.00)");
    // 角瓣是实色纸背(卡色自带,不透明),不带内容克隆
    expect(flap!.style.getPropertyValue("--card-color")).not.toBe("");
    expect(flap!.children.length).toBe(0);
    // 卡片本体保留对侧(五边形,顶点补齐到 6 个保证可过渡)
    expect((card.element as HTMLElement).style.clipPath).toBe(
      "polygon(27.2px 0.0px, 300.0px 0.0px, 300.0px 200.0px, 0.0px 200.0px, 0.0px 45.3px, 0.0px 45.3px)",
    );
    // 折角阶段:纸未离账,不产生纸片、不变虚线占位
    expect(ghostEl()).toBeNull();
    expect(card.classes()).not.toContain("placeholder");
    expect(wrapper.emitted("detach")).toBeUndefined();
  });

  it("折角后松手(折痕未及胶带):折角展开平复(fold-settle),无 detach", async () => {
    const wrapper = mountCard();
    const card = wrapper.find(".card");
    pointer("pointerdown", 300, 300, card.element);
    pointer("pointermove", 320, 312, card.element);
    pointer("pointerup", 320, 312, card.element);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("detach")).toBeUndefined();
    expect(ghostEl()).toBeNull();
    const flap = flapEl();
    expect(flap).not.toBeNull();
    expect(flap!.classList.contains("fold-settle")).toBe(true);
  });

  it("拖动未及胶带:始终原位折角,不撕离不变占位", async () => {
    const wrapper = mountCard();
    const card = wrapper.find(".card");
    pointer("pointerdown", 300, 300, card.element);
    // 向右拖 100px:折进一半(盖到胶带需 124.5px),未触发任何撕离条件
    pointer("pointermove", 400, 300, card.element);
    await wrapper.vm.$nextTick();

    expect(flapEl()).not.toBeNull();
    expect(ghostEl()).toBeNull();
    expect(card.classes()).not.toContain("placeholder");
    // 折痕顶点不越出卡片
    const clip = (card.element as HTMLElement).style.clipPath;
    expect(clip.match(/-?\d+(\.\d+)?px/g)?.every((v) => {
      const n = Number.parseFloat(v);
      return n >= 0 && n <= 300;
    })).toBe(true);
  });

  it("向下拉扯(顺胶带粘着方向揭纸):拖够承诺距离立即撕离", async () => {
    const wrapper = mountCard();
    const card = wrapper.find(".card");
    pointer("pointerdown", 300, 300, card.element);
    // 正下方拖 50px:既非折痕线穿过胶带也非折面盖过,纯"向下揭"路径
    pointer("pointermove", 300, 350, card.element);
    await wrapper.vm.$nextTick();

    const events = wrapper.emitted<[Record<string, number>]>("detach")!;
    expect(events).toHaveLength(1);
    expect(events[0][0]).toEqual({ dx: 100, dy: 100, clientX: 300, clientY: 350 });
    expect(ghostEl()).not.toBeNull();
    expect(card.classes()).toContain("placeholder");
    expect(flapEl()).toBeNull();
  });

  it("横向拖拽折面盖过胶带:拖动中即自动撕离起飞(第一卡片场景回归)", async () => {
    const wrapper = mountCard();
    const card = wrapper.find(".card");
    pointer("pointerdown", 300, 300, card.element);
    pointer("pointermove", 340, 326, card.element); // 先斜折角(Δ=(40,26))
    await wrapper.vm.$nextTick();
    expect(flapEl()).not.toBeNull();
    // 横向拖到 Δ=(140,0):折进距离过半,折面(镜像像)已盖过胶带锚点 → 撕离
    pointer("pointermove", 440, 300, card.element);
    await wrapper.vm.$nextTick();

    const events = wrapper.emitted<[Record<string, number>]>("detach")!;
    expect(events).toHaveLength(1);
    expect(events[0][0]).toEqual({ dx: 100, dy: 100, clientX: 440, clientY: 300 });
    expect(ghostEl()).not.toBeNull();
    expect(card.classes()).toContain("placeholder");
    expect(flapEl()).toBeNull();
  });

  it("折痕斜着拖到触及胶带:拖动中即自动撕离起飞(卷角由拖动距离截断衔接)", async () => {
    const wrapper = mountCard();
    const card = wrapper.find(".card");
    pointer("pointerdown", 300, 300, card.element);
    pointer("pointermove", 340, 326, card.element); // 斜折角(Δ=(40,26))
    await wrapper.vm.$nextTick();
    expect(flapEl()).not.toBeNull();
    // 斜着拖到 Δ=(120,120):斜折痕穿过胶带矩形(四角符号距离异号),撕离成窗
    pointer("pointermove", 420, 420, card.element);
    await wrapper.vm.$nextTick();

    const events = wrapper.emitted<[Record<string, number>]>("detach")!;
    expect(events).toHaveLength(1);
    // 载荷的落点 = 折痕触及胶带时的光标位置
    expect(events[0][0]).toEqual({ dx: 100, dy: 100, clientX: 420, clientY: 420 });
    // 纸片已起飞,原位变虚线占位;卷角 = 此前拖动距离(47.7)截断至 28px
    const ghost = ghostEl();
    expect(ghost).not.toBeNull();
    expect(card.classes()).toContain("placeholder");
    expect(flapEl()).toBeNull();
    const curl = ghost!.querySelector<HTMLElement>(".g-curl");
    expect(curl).not.toBeNull();
    expect(curl!.style.width).toBe("28px");
    // 建窗交接前纸片保持在场(fly 切换在双帧之后,此处仍为 follow 态)
  });

  it("撕离起飞:纸片全程保持卡片尺寸,只位移到窗口纸片原点(高度瞬跳回归)", async () => {
    const wrapper = mountCard();
    const card = wrapper.find(".card");
    pointer("pointerdown", 300, 300, card.element);
    // 向下揭 50px:立即撕离;flyToWindow 换算(scale=1,窗口原点 1000,500,
    // 抓取偏移 100,100)得窗口左上角 (200,250),加 5px 阴影边距 → 纸片落点 (205,255)
    pointer("pointermove", 300, 350, card.element);
    await wrapper.vm.$nextTick();
    // fly 态在 IPC + 双渲染帧后才切换:等真实定时器走完该链路
    await new Promise((r) => setTimeout(r, 60));

    const ghost = ghostEl()!;
    expect(ghost.classList.contains("mode-fly")).toBe(true);
    // 回归:fly 态不得改宽高——此前纸片会被撑到 360×380 窗口尺寸,
    // 侧向拉扯时高度增量集中在头几帧,看起来就是"脱落瞬间突然变高"
    expect(ghost.style.width).toBe("300px");
    expect(ghost.style.height).toBe("200px");
    expect(ghost.style.transform).toBe("translate(5px, 55px)");
    expect(ghost.style.getPropertyValue("--fly-dur")).toBe("160ms");
  });

  it("按钮上按下不启动手势", async () => {
    const wrapper = mountCard();
    const btn = wrapper.find(".icon-btn");
    pointer("pointerdown", 300, 300, btn.element);
    pointer("pointermove", 380, 380, btn.element);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("detach")).toBeUndefined();
    expect(ghostEl()).toBeNull();
    expect(flapEl()).toBeNull();
    expect(wrapper.find(".card").classes()).not.toContain("lifted");
  });

  it("拖出按钮点击:同链路发出 detach 并生成纸片", async () => {
    const wrapper = mountCard();
    await wrapper.findAll(".icon-btn")[1].trigger("click");
    await wrapper.vm.$nextTick();
    const events = wrapper.emitted("detach")!;
    expect(events).toHaveLength(1);
    expect(ghostEl()).not.toBeNull();
  });
});
