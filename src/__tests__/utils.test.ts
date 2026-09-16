import { describe, it, expect } from "vitest";
import { dateKey, formatDateLabel, relativeTime, NOTE_COLORS, formatReminderTime, formatReminderShort } from "../types";

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

describe("formatReminderTime", () => {
  // Node 与 WebView2 均内置 full-icu,中英文格式化行为一致
  const ts = new Date(2026, 8, 11, 14, 30).getTime();

  it("中文:9月11日 14:30(24 小时制,非 numeric 的 9/11)", () => {
    expect(formatReminderTime(ts, "zh-CN")).toBe("9月11日 14:30");
  });

  it("英文:Sep 11, 02:30 PM(12 小时制)", () => {
    expect(formatReminderTime(ts, "en-US")).toMatch(/^Sep 11, \d{2}:\d{2} PM$/);
  });

  it("跨年提醒带年份", () => {
    const year = new Date().getFullYear() + 1;
    const nextJan3 = new Date(year, 0, 3, 9, 0).getTime();
    expect(formatReminderTime(nextJan3, "zh-CN")).toContain(`${year}年`);
    expect(formatReminderTime(nextJan3, "en-US")).toContain(String(year));
  });
});

describe("formatReminderShort", () => {
  const ts = new Date(2026, 8, 11, 14, 30).getTime();

  it("中文:9月11日 14:30(与完整格式一致)", () => {
    expect(formatReminderShort(ts, "zh-CN")).toBe("9月11日 14:30");
  });

  it("英文:数字日期 + 不补零 12 小时制(9/11 2:30 PM,窄行不溢出)", () => {
    expect(formatReminderShort(ts, "en-US")).toMatch(/^9\/11 \d{1,2}:\d{2} [AP]M$/);
  });

  it("今天的提醒只显示时间(2:30 PM / 14:30)", () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 30).getTime();
    expect(formatReminderShort(today, "en-US")).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
    expect(formatReminderShort(today, "zh-CN")).toBe("14:30");
  });

  it("跨年带年份", () => {
    const year = new Date().getFullYear() + 1;
    const nextJan3 = new Date(year, 0, 3, 9, 0).getTime();
    expect(formatReminderShort(nextJan3, "zh-CN")).toContain(`${year}年`);
    expect(formatReminderShort(nextJan3, "en-US")).toContain(String(year));
  });
});

describe("NOTE_COLORS", () => {
  it("颜色常量保持 6 色", () => {
    expect(NOTE_COLORS).toHaveLength(6);
  });
});
