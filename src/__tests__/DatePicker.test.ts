import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { NoteWithItems } from "../types";
import DatePicker from "../components/DatePicker.vue";
import { useNotesStore } from "../stores/notes";

// store 依赖 celebrate→canvas-confetti:jsdom 无 canvas,模块加载即抛错,必须 mock 掉
vi.mock("../celebrate", () => ({ celebrateAllDone: vi.fn() }));

function makeNote(id: string, createdAt: number): NoteWithItems {
  return {
    id,
    type: "note",
    title: id,
    content: null,
    color: null,
    pinned: false,
    createdAt,
    updatedAt: createdAt,
    items: [],
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

function mountPicker() {
  return mount(DatePicker);
}

describe("DatePicker", () => {
  it("默认收起,点击按钮后展开面板,再次点击收起", async () => {
    const wrapper = mountPicker();
    expect(wrapper.find(".dp-panel").exists()).toBe(false);
    await wrapper.find(".dp-btn").trigger("click");
    expect(wrapper.find(".dp-panel").exists()).toBe(true);
    await wrapper.find(".dp-btn").trigger("click");
    expect(wrapper.find(".dp-panel").exists()).toBe(false);
  });

  it("渲染 7 个周标签和 42 个日期格,当月完整覆盖", () => {
    const wrapper = mountPicker();
    wrapper.find(".dp-btn").trigger("click");
    return vi.waitFor(() => {
      expect(wrapper.findAll(".dp-week")).toHaveLength(7);
      expect(wrapper.findAll(".dp-day")).toHaveLength(42);
    });
  });

  it("有记录的日期渲染圆点标记", async () => {
    const store = useNotesStore();
    const today = new Date();
    store.notes = [makeNote("n1", today.getTime())];
    const wrapper = mountPicker();
    await wrapper.find(".dp-btn").trigger("click");
    expect(wrapper.findAll(".dp-dot")).toHaveLength(1);
  });

  it("今天有高亮标识", async () => {
    const wrapper = mountPicker();
    await wrapper.find(".dp-btn").trigger("click");
    expect(wrapper.find(".dp-day.today").exists()).toBe(true);
  });

  it("点击日期写入 store 并收起面板", async () => {
    const store = useNotesStore();
    const wrapper = mountPicker();
    await wrapper.find(".dp-btn").trigger("click");
    const todayCell = wrapper.find(".dp-day.today");
    await todayCell.trigger("click");
    expect(store.dateFilter).toBe(dateKeyOfToday());
    expect(wrapper.find(".dp-panel").exists()).toBe(false);
  });

  it("清除筛选按钮:无筛选时禁用,有筛选时可清空", async () => {
    const store = useNotesStore();
    const wrapper = mountPicker();
    await wrapper.find(".dp-btn").trigger("click");
    const clearBtn = wrapper.findAll(".dp-act").find((b) => b.text() === "清除筛选")!;
    expect(clearBtn.attributes("disabled")).toBeDefined();
    store.setDateFilter(todayKey());
    await vi.waitFor(() => {
      expect(clearBtn.attributes("disabled")).toBeUndefined();
    });
    await clearBtn.trigger("click");
    expect(store.dateFilter).toBeNull();
  });

  it("上/下月切换更新标题", async () => {
    const wrapper = mountPicker();
    await wrapper.find(".dp-btn").trigger("click");
    const now = new Date();
    const label = (y: number, m: number) => `${y}年${m}月`;
    const before = wrapper.find(".dp-month").text();
    expect(before).toBe(label(now.getFullYear(), now.getMonth() + 1));
    // 第二个导航按钮是"下个月 ›",第一个是"上个月 ‹"
    await wrapper.findAll(".dp-nav")[1]!.trigger("click");
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    expect(wrapper.find(".dp-month").text()).toBe(label(next.getFullYear(), next.getMonth() + 1));
    await wrapper.findAll(".dp-nav")[0]!.trigger("click");
    await wrapper.findAll(".dp-nav")[0]!.trigger("click");
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    expect(wrapper.find(".dp-month").text()).toBe(label(prev.getFullYear(), prev.getMonth() + 1));
  });
});

function todayKey(): string {
  return dateKeyOfToday();
}
function dateKeyOfToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
