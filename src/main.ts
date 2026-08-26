import { createApp } from "vue";
import { createPinia } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App.vue";
import NoteWindowApp from "./NoteWindowApp.vue";

// 独立便签窗口的 label 形如 note-<id>,据此分流渲染
const isNoteWindow = getCurrentWindow().label.startsWith("note-");

const app = createApp(isNoteWindow ? NoteWindowApp : App);
app.use(createPinia());
app.mount("#app");
