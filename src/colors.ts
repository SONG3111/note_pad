// 卡片色的渲染层映射: 存量数据里的旧色值(清新简约时期) → 复古手账莫兰迪色。
// 只在渲染层生效, 数据库 color 字段(字符串)的结构与读写习惯完全不变;
// 新建/换色写入的已是 NOTE_COLORS 新色值, mapCardColor 对其原样透传。
import { NOTE_COLORS } from "./types";

const LEGACY_COLOR_MAP: Record<string, string> = {
  "#f6f7f9": NOTE_COLORS[0], // 灰白 → 米纸
  "#ffe58f": NOTE_COLORS[1], // 明黄 → butter yellow
  "#b7f0cd": NOTE_COLORS[2], // 薄荷绿 → sage green
  "#bcd9ff": NOTE_COLORS[3], // 天蓝 → dusty blue
  "#ffb3b3": NOTE_COLORS[4], // 粉红 → dusty rose
  "#e3c8ff": NOTE_COLORS[5], // 亮紫 → lavender
};

export function mapCardColor(color: string | null): string {
  if (!color) return NOTE_COLORS[0];
  return LEGACY_COLOR_MAP[color.toLowerCase()] ?? color;
}
