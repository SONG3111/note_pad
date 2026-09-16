import { describe, it, expect } from "vitest";
import { dateKey, formatDateLabel, relativeTime, NOTE_COLORS } from "../types";

describe("dateKey", () => {
  it("把时间戳转为本地时区 YYYY-MM-DD", () => {
    // 构造一个明确的本地日期:2026-08-30 15:30 本地时间
    const ts = new Date(2026, 7, 30, 15, 30).getTime();
    expect(dateKey(ts)).toBe("2026-08-30");
  });

  it("月和日补零", () => {
    const ts = new Date(2026, 0, 5, 8, 0).getTime();
    expect(dateKey(ts)).toBe("2026-01-05");
  });

  it("与 toISOString 不同:本地日期而非 UTC 日期(东八区凌晨 0~8 点场景)", () => {
    // 北京时间 2026-08-30 02:00 = UTC 2026-08-29 18:00
    const ts = new Date(2026, 7, 30, 2, 0).getTime();
    const utcIsoDate = new Date(ts).toISOString().slice(0, 10);
    expect(dateKey(ts)).toBe("2026-08-30");
    // 仅当机器时区为 UTC+8 及以西时成立;时区无关性正是本函数的职责
    if (new Date().getTimezoneOffset() <= -480) {
      expect(utcIsoDate).toBe("2026-08-29");
    }
  });

  it("跨月边界日期正确", () => {
    expect(dateKey(new Date(2026, 7, 31, 23, 59).getTime())).toBe("2026-08-31");
    expect(dateKey(new Date(2026, 8, 1, 0, 0).getTime())).toBe("2026-09-01");
  });
});

describe("formatDateLabel", () => {
  it("解析 YYYY-MM-DD 并去前导零(中文)", () => {
    expect(formatDateLabel("2026-08-30", "zh-CN")).toBe("8月30日");
    expect(formatDateLabel("2026-01-05", "zh-CN")).toBe("1月5日");
  });
  it("英文格式 M/D", () => {
    expect(formatDateLabel("2026-08-30", "en-US")).toBe("8/30");
    expect(formatDateLabel("2026-01-05", "en-US")).toBe("1/5");
  });
});

describe("relativeTime", () => {
  it("刚刚(< 1 分钟)", () => {
    expect(relativeTime(Date.now() - 30_000, "zh-CN")).toBe("刚刚");
    expect(relativeTime(Date.now() - 30_000, "en-US")).toBe("just now");
  });
  it("N 分钟前", () => {
    expect(relativeTime(Date.now() - 5 * 60_000, "zh-CN")).toBe("5 分钟前");
    expect(relativeTime(Date.now() - 5 * 60_000, "en-US")).toBe("5m ago");
  });
  it("N 小时前", () => {
    expect(relativeTime(Date.now() - 3 * 3600_000, "zh-CN")).toBe("3 小时前");
    expect(relativeTime(Date.now() - 3 * 3600_000, "en-US")).toBe("3h ago");
  });
  it("N 天前(7 天内)", () => {
    expect(relativeTime(Date.now() - 2 * 86400_000, "zh-CN")).toBe("2 天前");
    expect(relativeTime(Date.now() - 2 * 86400_000, "en-US")).toBe("2d ago");
  });
  it("超过 7 天回退到本地日期", () => {
    const ts = Date.now() - 30 * 86400_000;
    expect(relativeTime(ts, "zh-CN")).toBe(new Date(ts).toLocaleDateString("zh-CN"));
    expect(relativeTime(ts, "en-US")).toBe(new Date(ts).toLocaleDateString("en-US"));
  });
});

describe("NOTE_COLORS", () => {
  it("颜色常量保持 6 色", () => {
    expect(NOTE_COLORS).toHaveLength(6);
  });
});
