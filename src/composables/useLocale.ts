// 语言状态管理:初始解析(localStorage 持久值 → 系统语言)、手动切换、跨窗口实时同步。
// 每个窗口(主窗口/独立便签窗口)都会执行 initLocale,各自解析出一致的语言。
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
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

/** 跨窗口语言同步的注销句柄:initLocale 每窗口只执行一次,窗口销毁随进程释放 */
let unlistenLocaleChanged: UnlistenFn | null = null;

/** 注销跨窗口语言同步监听(生产里窗口销毁即释放,主要供测试/重复初始化场景) */
export function disposeLocaleListener() {
  unlistenLocaleChanged?.();
  unlistenLocaleChanged = null;
}

/** 窗口挂载前调用:解析并应用语言,同时监听其他窗口的切换广播 */
export function initLocale() {
  const loc = resolveInitialLocale();
  applyLocale(loc);
  // Rust 侧启动只按系统语言初始化,持久化语言须在这里同步过去:
  // 否则系统语言与用户选择不一致时,重启后托盘菜单与待办提醒通知标题会用错语言
  invoke("set_app_locale", { locale: loc }).catch(() => {});
  // 其他窗口切换了语言 → 本窗口实时跟随(不回写存储、不再广播,避免循环)
  void listen<AppLocale>("app-locale-changed", (e) => {
    if (e.payload !== appLocale.value) applyLocale(e.payload);
  }).then((fn) => (unlistenLocaleChanged = fn));
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
