import type { AppLocale } from "./i18n";

export type NoteType = "note" | "todo";

export interface TodoItem {
  id: string;
  noteId: string;
  text: string;
  checked: boolean;
  sortOrder: number;
  updatedAt: number;
  /** 单次提醒时间(Unix 毫秒);null = 未设置,触发后由后端调度清除 */
  remindAt: number | null;
}

export interface Note {
  id: string;
  type: NoteType;
  title: string | null;
  content: string | null;
  color: string | null;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface NoteWithItems extends Note {
  items: TodoItem[];
}

/// 手账色卡: 降饱和的便签纸色, 存入数据库的仍是 hex 字符串(结构不变)。
/// 存量旧色值的兼容映射见 colors.ts 的 mapCardColor
export const NOTE_COLORS = [
  "#f8f3e7", // 米纸
  "#f0dfae", // butter yellow
  "#c7d8ba", // sage green
  "#c1d3de", // dusty blue
  "#e5c2b8", // dusty rose
  "#d5c6dd", // lavender
] as const;

/// 相对时间文案:保持纯函数,locale 由调用方传入(组件里取 appLocale)
export function relativeTime(ts: number, locale: AppLocale): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return locale === "zh-CN" ? "刚刚" : "just now";
  if (m < 60) return locale === "zh-CN" ? `${m} 分钟前` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return locale === "zh-CN" ? `${h} 小时前` : `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return locale === "zh-CN" ? `${d} 天前` : `${d}d ago`;
  return new Date(ts).toLocaleDateString(locale);
}

/// Unix 毫秒 → 本地时区 "YYYY-MM-DD"。
/// 用本地年月日拼装而非 toISOString(UTC),避免跨时区日期错位
export function dateKey(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/// "YYYY-MM-DD" → "M月D日"/"M/D"(去前导零),用于筛选态提示文案
export function formatDateLabel(key: string, locale: AppLocale): string {
  const [, m, d] = key.split("-").map(Number);
  return locale === "zh-CN" ? `${m}月${d}日` : `${m}/${d}`;
}

/// 提醒时间展示文案:"9月11日 14:30"/"Sep 11, 2:30 PM"(跨年时带年份)
export function formatReminderTime(ts: number, locale: AppLocale): string {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString(locale, {
    // zh 的 numeric 输出是 "9/11",用 long 才是 "9月11日";en 用 short 得 "Sep 11"
    month: locale === "zh-CN" ? "long" : "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const time = d.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: locale !== "zh-CN",
  });
  return locale === "zh-CN" ? `${date} ${time}` : `${date}, ${time}`;
}

/// 提醒时间的紧凑文案(窄行内联标签用):今天的提醒只显示时间,
/// 同年的 en 用数字日期 + 不补零小时("9/11 2:30 PM"),zh 维持 "9月11日 14:30"
export function formatReminderShort(ts: number, locale: AppLocale): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(locale, {
    hour: locale === "zh-CN" ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: locale !== "zh-CN",
  });
  if (dateKey(ts) === dateKey(Date.now())) return time;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString(locale, {
    // zh 的 numeric 输出是 "9/11",用 long 保持 "9月11日";en 用 numeric 得最短的 "9/11"
    month: locale === "zh-CN" ? "long" : "numeric",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${date} ${time}`;
}
