import { createApp } from "vue";
import { createPinia } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
// 霞鹜文楷 Screen(手账风标题/装饰字体, 分片 woff2 按需加载)
import "lxgw-wenkai-screen-webfont/lxgwwenkaiscreen.css";
import "./design.css";
import App from "./App.vue";
import NoteWindowApp from "./NoteWindowApp.vue";

// 独立便签窗口的 label 形如 note-<id>,据此分流渲染
const isNoteWindow = getCurrentWindow().label.startsWith("note-");

const app = createApp(isNoteWindow ? NoteWindowApp : App);
app.use(createPinia());
app.mount("#app");
