// 应用内国际化:中英双语。文案量小,两个语言包静态打包(无需懒加载)。
// Rust 侧托盘/窗口标题的双语维护见 src-tauri/src/i18n.rs,两边 locale 取值须保持一致。
import { createI18n } from "vue-i18n";
import zhCN from "./locales/zh-CN";
import enUS from "./locales/en-US";

export type AppLocale = "zh-CN" | "en-US";

export const LOCALES: AppLocale[] = ["zh-CN", "en-US"];
export const LOCALE_STORAGE_KEY = "app-locale";

const i18n = createI18n({
  legacy: false, // Composition API 模式,与项目 <script setup> 风格一致
  locale: "zh-CN", // 实际初始值由 useLocale 的 initLocale() 按系统语言覆写
  fallbackLocale: "zh-CN",
  messages: { "zh-CN": zhCN, "en-US": enUS },
});

export default i18n;
