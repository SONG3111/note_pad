import { createApp } from "vue";
import { createPinia } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import i18n from "./i18n";
import { initLocale } from "./composables/useLocale";
// 霞鹜文楷 Screen(手账风标题/装饰字体, 分片 woff2 按需加载)
import "lxgw-wenkai-screen-webfont/lxgwwenkaiscreen.css";
import "./design.css";
import App from "./App.vue";
import NoteWindowApp from "./NoteWindowApp.vue";
import ReminderPopupApp from "./ReminderPopupApp.vue";

// 按 label 分流渲染:note-<id> 独立便签窗口;reminder-pop-<itemId> 提醒选择弹窗
const label = getCurrentWindow().label;
const isNoteWindow = label.startsWith("note-");
const isReminderPopup = label.startsWith("reminder-pop-");

// 语言在挂载前解析(localStorage → 系统语言),避免首帧闪现错误语言
initLocale();

const root = isReminderPopup ? ReminderPopupApp : isNoteWindow ? NoteWindowApp : App;
const app = createApp(root);
app.use(createPinia());
app.use(i18n);
app.mount("#app");
