<template>
  <transition name="fade">
    <div v-if="visible" class="notification">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <span @click="handleClick" v-html="safeMessage"></span>
      <button class="close-btn" @click="hideNotification">✕</button>
    </div>
  </transition>
</template>

<script setup>
import { computed, ref } from 'vue'
import { sanitizeToastHtml } from '@/utils/htmlSanitizer'

const visible = ref(false)
const message = ref('')
const onClick = ref(null)
const hideTimeoutId = ref(null)
const safeMessage = computed(() => sanitizeToastHtml(message.value))

const showNotification = (msg, duration = 3000, options = {}) => {
  // Подавляем сообщения про неавторизованность от внешнего API —
  // они не релевантны пользователю (у нас собственная авторизация через Telegram)
  if (typeof msg === 'string' && (
    msg.includes('Не авторизован') ||
    msg.includes('Доступно только в приложении') ||
    msg.includes('401') ||
    msg.toLowerCase().includes('unauthorized')
  )) {
    return
  }
  message.value = msg
  onClick.value = options.onClick || null
  visible.value = true

  if (hideTimeoutId.value) {
    clearTimeout(hideTimeoutId.value)
  }

  hideTimeoutId.value = setTimeout(() => {
    visible.value = false
    hideTimeoutId.value = null
  }, duration)
}

const hideNotification = () => {
  if (hideTimeoutId.value) {
    clearTimeout(hideTimeoutId.value)
    hideTimeoutId.value = null
  }
  visible.value = false
}

const handleClick = (event) => {
  const link = event.target.closest('a')
  if (link && onClick.value) {
    event.preventDefault()
    onClick.value()
  }
}

// Экспортируем функцию для вызова уведомления
defineExpose({ showNotification })
</script>

<style scoped>
.notification {
  position: fixed;
  top: 70px;
  right: 20px;
  bottom: auto;
  left: auto;
  transform: none;
  background: rgba(15, 20, 32, 0.97);
  border: 1px solid rgba(0, 229, 255, 0.25);
  color: var(--text-color);
  padding: 10px 14px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  max-width: 360px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  z-index: 1000;
}

.close-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color 0.15s;
}
.close-btn:hover { color: #fff; }

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

:deep(a) {
  color: var(--accent-color);
  text-decoration: underline;
  cursor: pointer;
  transition: color 0.2s ease;
}

:deep(a:hover) {
  color: var(--accent-hover);
}

.success-icon {
  color: var(--accent-color);
}
</style>
