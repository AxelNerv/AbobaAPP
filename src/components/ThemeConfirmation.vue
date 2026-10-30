<template>
  <Teleport to="body">
    <dialog ref="dialog" class="theme-confirmation" aria-labelledby="theme-confirm-title" aria-describedby="theme-confirm-detail" @cancel.prevent.stop="emit('cancel')" @keydown.esc.stop.prevent="emit('cancel')" @click.stop>
      <SeasonalGhost />
      <h2 id="theme-confirm-title">Применить тему «{{ name }}»?</h2>
      <p id="theme-confirm-detail">{{ desktop ? 'Приложение перезапустится. Просмотр прервётся; раздачу по Wi-Fi потребуется включить снова.' : 'Страница перезагрузится. Текущий просмотр прервётся.' }} Классические настройки цвета и фона сохранятся.</p>
      <p v-if="error" role="alert" class="confirmation-error">{{ error }}</p>
      <div class="confirmation-actions">
        <button type="button" :disabled="busy" autofocus @click="emit('cancel')">Нет</button>
        <button type="button" :disabled="busy" @click="emit('confirm')">{{ busy ? 'Применяем…' : 'Да' }}</button>
      </div>
    </dialog>
  </Teleport>
</template>
<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import SeasonalGhost from './SeasonalGhost.vue'
defineProps({ name: String, desktop: Boolean, busy: Boolean, error: String })
const emit = defineEmits(['cancel', 'confirm'])
const dialog = ref(null)
let previousFocus
onMounted(() => { previousFocus = document.activeElement; dialog.value.showModal() })
onBeforeUnmount(() => { dialog.value?.close(); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) })
</script>
<style scoped>
.theme-confirmation { box-sizing: border-box; width: min(440px, calc(100vw - 32px)); padding: 28px; color: var(--text-color); background: var(--bg-modal); border: 1px solid var(--border-hover); border-radius: 18px; }
.theme-confirmation::backdrop { background: #000b; }
h2 { font-size: 21px; line-height: 1.4; margin: 0 0 12px; }
p { color: var(--text-secondary); font-size: 14px; line-height: 1.7; }
.confirmation-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
button { min-width: 76px; min-height: 44px; border-radius: 9px; border: 1px solid var(--border-hover); background: var(--bg-card); color: var(--text-color); cursor: pointer; }
button:last-child { background: rgba(var(--accent-rgb), .18); }
button:disabled { opacity: .6; cursor: wait; }
.confirmation-error { color: #ffb0a9; }
</style>
