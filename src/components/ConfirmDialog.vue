<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { useI18n } from "vue-i18n";

defineProps<{
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();

// 文案由父组件用 t() 传入;此处的 i18n 兜底保证漏传时也不会出现硬编码语言
const { t } = useI18n();

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") emit("cancel");
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('cancel')">
      <div class="dialog">
        <div class="icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/>
          </svg>
        </div>
        <h3>{{ title ?? t("dialog.deleteTitle") }}</h3>
        <p>{{ message }}</p>
        <div class="actions">
          <button class="d-btn cancel" @click="emit('cancel')">{{ cancelText ?? t("dialog.cancel") }}</button>
          <button class="d-btn danger" autofocus @click="emit('confirm')">{{ confirmText ?? t("dialog.delete") }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(64, 49, 35, 0.35);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
  display: grid;
  place-items: center;
  z-index: 200;
  animation: fade-in 0.15s var(--ease-out);
}
@keyframes fade-in {
  from { opacity: 0; }
}
.dialog {
  width: min(320px, 86vw);
  background-color: var(--surface);
  background-image: var(--grain);
  border: 1px solid var(--border-strong);
  border-radius: 16px 19px 15px 19px / 19px 15px 19px 16px;
  padding: 24px 22px 20px;
  box-shadow: var(--shadow-l);
  text-align: center;
  animation: pop-in 0.2s var(--ease-out);
}
@keyframes pop-in {
  from { transform: scale(0.95) translateY(8px); opacity: 0; }
}
.icon {
  width: 46px;
  height: 46px;
  margin: 0 auto 14px;
  border-radius: 50%;
  background: var(--danger-soft);
  color: var(--danger);
  display: grid;
  place-items: center;
}
h3 {
  margin: 0 0 6px;
  font-family: var(--font-hand);
  font-size: 16.5px;
  font-weight: 400;
  letter-spacing: 0.5px;
  color: var(--text-strong);
}
p {
  margin: 0 0 20px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-muted);
}
.actions {
  display: flex;
  gap: 10px;
}
.d-btn {
  flex: 1;
  border: none;
  border-radius: var(--radius-m);
  padding: 9px 0;
  font-size: 13.5px;
  cursor: pointer;
  transition:
    background 0.15s var(--ease-out),
    transform 0.08s var(--ease-out),
    box-shadow 0.15s var(--ease-out);
}
.d-btn:active { transform: scale(0.97); }
.d-btn.cancel {
  background: var(--surface-2);
  color: var(--text);
}
.d-btn.cancel:hover { background: var(--bg-soft); }
.d-btn.danger {
  background: var(--danger);
  color: #fff;
  box-shadow: 0 4px 12px var(--danger-soft);
}
.d-btn.danger:hover { background: #d6363b; }
</style>
