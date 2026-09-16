// 语言状态管理:初始解析(localStorage 持久值 → 系统语言)、手动切换、跨窗口实时同步。
// 每个窗口(主窗口/独立便签窗口)都会执行 initLocale,各自解析出一致的语言。
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import i18n, { LOCALE_STORAGE_KEY, type AppLocale } from "../i18n";

/** 当前语言的响应式引用,供日期格式化等非模板场景使用(模板里直接用 t) */
export const appLocale = ref<AppLocale>("zh-CN");

/** 语言解析规则:持久值优先,其次系统语言(zh 开头 → 中文)。导出供单测覆盖 */
export function resolveInitialLocale(): AppLocale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === "zh-CN" || saved === "en-US") return saved;
  } catch {
    // localStorage 不可用时退回系统语言
  }
  const lang = navigator.language ?? "";
  return lang.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function applyLocale(loc: AppLocale) {
  i18n.global.locale.value = loc;
  appLocale.value = loc;
  document.documentElement.lang = loc;
  document.title = i18n.global.t("app.name");
}

/** 窗口挂载前调用:解析并应用语言,同时监听其他窗口的切换广播 */
export function initLocale() {
  applyLocale(resolveInitialLocale());
  // 其他窗口切换了语言 → 本窗口实时跟随(不回写存储、不再广播,避免循环)
  void listen<AppLocale>("app-locale-changed", (e) => {
    if (e.payload !== appLocale.value) applyLocale(e.payload);
  });
}

/** 手动切换语言:更新界面 + 持久化 + 通知 Rust 重建托盘 + 广播到其他窗口 */
export async function setLocale(loc: AppLocale) {
  if (loc === appLocale.value) return;
  applyLocale(loc);
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, loc);
  } catch {}
  try {
    // 托盘菜单/tooltip 与后续新建窗口的标题由 Rust 侧按此 locale 重建
    await invoke("set_app_locale", { locale: loc });
  } catch {}
  emit("app-locale-changed", loc).catch(() => {});
}

export function toggleLocale() {
  void setLocale(appLocale.value === "zh-CN" ? "en-US" : "zh-CN");
}
