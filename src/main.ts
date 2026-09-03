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

// 独立便签窗口的 label 形如 note-<id>,据此分流渲染
const isNoteWindow = getCurrentWindow().label.startsWith("note-");

// 语言在挂载前解析(localStorage → 系统语言),避免首帧闪现错误语言
initLocale();

const app = createApp(isNoteWindow ? NoteWindowApp : App);
app.use(createPinia());
app.use(i18n);
app.mount("#app");
