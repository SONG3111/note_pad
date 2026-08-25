<script setup lang="ts">
defineProps<{ checked: boolean }>();
const emit = defineEmits<{ change: [] }>();
</script>

<template>
  <label class="cb-wrap">
    <input class="cb-input" type="checkbox" :checked="checked" @change="emit('change')" />
    <span class="cb-box" aria-hidden="true">
      <svg class="cb-check" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4.5 12.5l5 5L19.5 7" />
      </svg>
    </span>
  </label>
</template>

<style scoped>
.cb-wrap {
  position: relative;
  display: inline-flex;
  flex: none;
  cursor: pointer;
}
.cb-input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.cb-box {
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 2px solid #cbd5e0;
  background: #fff;
  display: grid;
  place-items: center;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.1s ease;
}
.cb-wrap:hover .cb-box {
  border-color: #94a3b8;
}
.cb-input:active + .cb-box {
  transform: scale(0.9);
}
.cb-input:focus-visible + .cb-box {
  box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.22);
}
.cb-check {
  width: 11px;
  height: 11px;
  stroke: #fff;
  stroke-width: 3.2;
  opacity: 0;
  transform: scale(0.25);
  transition:
    opacity 0.15s cubic-bezier(0.2, 0, 0, 1),
    transform 0.18s cubic-bezier(0.2, 0, 0, 1);
}
.cb-input:checked + .cb-box {
  background-color: #059669;
  border-color: #059669;
}
.cb-input:checked + .cb-box .cb-check {
  opacity: 1;
  transform: scale(1);
}
</style>
