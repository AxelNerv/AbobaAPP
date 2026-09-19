<template>
  <transition name="slide-down">
    <div v-if="show" class="tg-banner">
      <div class="tg-banner-content">
        <div class="tg-banner-icon">
          <AppIcon name="externalLink" :size="16" />
        </div>
        <div class="tg-banner-text">
          <div class="tg-banner-title">Откройте в браузере</div>
          <div class="tg-banner-subtitle">
            Сайт может работать нестабильно во встроенном браузере Telegram
          </div>
        </div>
        <button class="tg-banner-btn" @click="openInBrowser">
          Открыть
        </button>
        <button class="tg-banner-close" @click="dismiss">
          <AppIcon name="close" :size="16" />
        </button>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'

const show = ref(false)
const STORAGE_KEY = 'abobatv_tg_banner_dismissed'

// Детектим Telegram WebView по UA-строке
const isTelegramWebView = () => {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent || ''
  // Telegram desktop: TelegramBot
  // Telegram iOS/Android in-app browser: содержит 'Telegram' или подобное
  // Также детектим через наличие window.Telegram (Mini Apps)
  if (window.Telegram?.WebApp) return true
  if (/Telegram/i.test(ua)) return true
  // На iOS Telegram использует свой UA
  if (/TelegramBot/i.test(ua)) return true
  return false
}

const copyCurrentUrl = async (url) => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API недоступен')
    await navigator.clipboard.writeText(url)
    alert('Ссылка скопирована — откройте в Safari или Chrome')
  } catch (error) {
    console.warn('[telegram] не удалось скопировать ссылку:', error?.message || error)
    alert(`Откройте ссылку вручную: ${url}`)
  }
}

const openInBrowser = async () => {
  // Пытаемся открыть текущий URL в системном браузере.
  // На iOS / Android Telegram это обычно срабатывает: Telegram отдаёт ссылку ОС,
  // та открывает Safari/Chrome.
  const url = window.location.href
  // Используем window.open с _blank — Telegram интерпретирует это как "открой во внешнем"
  try {
    const opened = window.open(url, '_blank')
    if (!opened) {
      await copyCurrentUrl(url)
    }
  } catch (error) {
    console.warn('[telegram] внешний браузер не открылся:', error?.message || error)
    await copyCurrentUrl(url)
  }
}

const dismiss = () => {
  show.value = false
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch (error) {
    console.warn('[telegram] не удалось запомнить закрытие баннера:', error?.message || error)
  }
}

onMounted(() => {
  if (!isTelegramWebView()) return
  // Если юзер уже закрыл баннер — не показываем
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === '1') return
  } catch (error) {
    console.warn('[telegram] не удалось прочитать состояние баннера:', error?.message || error)
  }
  show.value = true
})
</script>

<style scoped>
.tg-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 999;
  background: linear-gradient(135deg, #229ed9, #1e7fb8);
  color: #fff;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}
.tg-banner-content {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  max-width: 720px;
  margin: 0 auto;
}
.tg-banner-icon {
  font-size: 20px;
  flex-shrink: 0;
}
.tg-banner-text { flex: 1; min-width: 0; }
.tg-banner-title { font-weight: 700; font-size: 14px; line-height: 1.2; }
.tg-banner-subtitle { font-size: 11px; opacity: 0.85; line-height: 1.3; margin-top: 2px; }
.tg-banner-btn {
  background: #fff;
  color: #229ed9;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.tg-banner-btn:hover { background: #f0f0f0; }
.tg-banner-close {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 12px;
}
.tg-banner-close:hover { background: rgba(255, 255, 255, 0.25); }

.slide-down-enter-active, .slide-down-leave-active {
  transition: transform 0.3s ease;
}
.slide-down-enter-from, .slide-down-leave-to {
  transform: translateY(-100%);
}
</style>
