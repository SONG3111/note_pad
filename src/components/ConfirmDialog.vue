<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";

defineProps<{
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();

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
        <h3>{{ title ?? "删除记录" }}</h3>
        <p>{{ message }}</p>
        <div class="actions">
          <button class="d-btn cancel" @click="emit('cancel')">{{ cancelText ?? "取消" }}</button>
          <button class="d-btn danger" autofocus @click="emit('confirm')">{{ confirmText ?? "删除" }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 30, 45, 0.4);
  display: grid;
  place-items: center;
  z-index: 200;
  animation: fade-in 0.15s ease;
}
@keyframes fade-in {
  from { opacity: 0; }
}
.dialog {
  width: min(320px, 86vw);
  background: #fff;
  border-radius: 14px;
  padding: 22px 20px 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  text-align: center;
  animation: pop-in 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
@keyframes pop-in {
  from { transform: scale(0.94) translateY(10px); opacity: 0; }
}
.icon {
  width: 44px;
  height: 44px;
  margin: 0 auto 12px;
  border-radius: 50%;
  background: #fff5f5;
  color: #e53e3e;
  display: grid;
  place-items: center;
}
h3 {
  margin: 0 0 6px;
  font-size: 15.5px;
  color: #2c3e50;
}
p {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.7;
  color: #718096;
}
.actions {
  display: flex;
  gap: 10px;
}
.d-btn {
  flex: 1;
  border: none;
  border-radius: 9px;
  padding: 9px 0;
  font-size: 13.5px;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.d-btn:active { transform: scale(0.97); }
.d-btn.cancel {
  background: #edf2f7;
  color: #4a5568;
}
.d-btn.cancel:hover { background: #e2e8f0; }
.d-btn.danger {
  background: #e53e3e;
  color: #fff;
}
.d-btn.danger:hover { background: #c53030; }
</style>
