export type NoteType = "note" | "todo";

export interface TodoItem {
  id: string;
  noteId: string;
  text: string;
  checked: boolean;
  sortOrder: number;
  updatedAt: number;
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

export const NOTE_COLORS = [
  "#f6f7f9",
  "#ffe58f",
  "#b7f0cd",
  "#bcd9ff",
  "#ffb3b3",
  "#e3c8ff",
] as const;

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

/// Unix 毫秒 → 本地时区 "YYYY-MM-DD"。
/// 用本地年月日拼装而非 toISOString(UTC),避免跨时区日期错位
export function dateKey(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/// "YYYY-MM-DD" → "M月D日"(去前导零),用于筛选态提示文案
export function formatDateLabel(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${m}月${d}日`;
}
