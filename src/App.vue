<template>
  <!-- Полоса для перетаскивания окна: рамка у приложения своя -->
  <div v-if="isDesktopApp" class="app-drag-strip"></div>

  <TelegramWebViewBanner />
  <BackgroundSpace />
  <MobileHeader v-if="isMobile" />
  <MenuNavigation />
  <FloatingBell v-if="!isMobile" />

  <main
    id="main-content"
    :class="['router-view-container', { 'router-view-container--with-mobile-header': isMobile }]"
  >
    <router-view v-slot="{ Component }">
      <component :is="Component" />
    </router-view>
  </main>

  <!-- Глобальный тост для уведомлений -->
  <Notification ref="globalToastRef" />

  <!-- Затемняющий оверлей для обычного режима, включается тумблером -->
  <div v-if="dimmingEnabled" class="dimming-overlay" @click="toggleDimming"></div>

  <div v-if="showGarland" id="garland" :style="{ backgroundImage: `url(${garlandImage})` }"></div>
</template>

<script setup>
const isDesktopApp = typeof window !== 'undefined' && !!window.electronAPI
if (isDesktopApp) document.documentElement.classList.add('is-desktop-app')

import BackgroundSpace from '@/components/BackgroundSpace.vue'
import { installSpatialNavigation } from '@/composables/useSpatialNavigation'
import MenuNavigation from '@/components/MenuNavigation.vue'
import MobileHeader from '@/components/MobileHeader.vue'
import Notification from '@/components/notification/ToastMessage.vue'
import FloatingBell from '@/components/FloatingBell.vue'
import TelegramWebViewBanner from '@/components/TelegramWebViewBanner.vue'
import { useMainStore } from '@/store/main'
import { useNavbarStore } from '@/store/navbar'
import { useFavoritesStore } from '@/store/favorites'
import { useAuthStore } from '@/store/auth'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { isNewYearPeriod } from '@/utils/dateUtils'
import garlandImage from '@/assets/trn-christmas-lights.webp'

const store = useMainStore()
const navbarStore = useNavbarStore()
const favoritesStore = useFavoritesStore()
const authStore = useAuthStore()
const appSubscriptions = []

const globalToastRef = ref(null)

const isMobile = computed(() => store.isMobile)

// Реактивное состояние для ширины окна.
// Пороговое значение 768 совпадает с CSS-брейкпоинтами на страницах
// (FavoritesPage @media max-width: 768px и др.). Иначе на ширине 600-768
// получается рассинхрон: App думает "десктоп" и оставляет sidebar-padding,
// а страница рендерится в "мобильной" вёрстке.
const MOBILE_BREAKPOINT = 768

const updateIsMobile = () => {
  store.setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
}

const handleKeyDown = (event) => {
  // Ctrl+F
  if (event.ctrlKey && event.keyCode === 70 && store.isCtrlFEnabled) {
    event.preventDefault()
    event.stopPropagation()
    navbarStore.openSearchModal()
  }

  // ESC
  if (event.keyCode === 27 && navbarStore.isModalSearchVisible) {
    event.preventDefault()
    event.stopPropagation()
    navbarStore.closeSearchModal()
  }
}

onMounted(() => {
  // Стрелки (пульт телевизора) переводят фокус на соседний элемент на любой странице
  appSubscriptions.push(installSpatialNavigation())
  store.setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
  window.addEventListener('resize', updateIsMobile)
  document.addEventListener('keydown', handleKeyDown, true)

  // Регистрируем глобальный тост для использования из любого места
  window.__toast = (msg, duration = 3500) => {
    try {
      globalToastRef.value?.showNotification(msg, duration)
    } catch (error) {
      console.error('[notifications] не удалось показать уведомление:', error)
    }
    // Также добавляем в историю уведомлений (колокольчик)
    try {
      if (typeof msg === 'string' && typeof window.__addNotification === 'function') {
        window.__addNotification(msg)
      }
    } catch (error) {
      console.error('[notifications] не удалось сохранить уведомление:', error)
    }
  }

  // Подтягиваем избранное с сервера при старте. Ошибка больше не выглядит
  // как успешная загрузка пустого списка и не уничтожает локальную копию.
  void favoritesStore.loadFromServer().catch((error) => {
    window.__toast(`Избранное не загрузилось: ${error?.message || 'ошибка сервера'}`, 6000)
  })

  // В приложении часть уведомлений приходит из главного процесса.
  // Без этой подписки они терялись по дороге.
  appSubscriptions.push(window.electronAPI?.onToast?.((message) => window.__toast(message)))
  appSubscriptions.push(window.electronAPI?.onBackendStatus?.(({ state, detail }) => {
    if (state === 'restarting') window.__toast('Бэкенд перезапускается…')
    if (state === 'failed') window.__toast(`Бэкенд недоступен: ${detail}`, 8000)
  }))
  appSubscriptions.push(window.electronAPI?.onRestored?.(() => {
    authStore.logout()
    store.setHistory([])
    favoritesStore.favorites = []
    window.__favorites = []
    localStorage.removeItem('abobatv_favorites_v1')
    window.location.reload()
  }))
})

onUnmounted(() => {
  appSubscriptions.forEach((unsubscribe) => unsubscribe?.())
  window.removeEventListener('resize', updateIsMobile)
  document.removeEventListener('keydown', handleKeyDown, true)
  delete window.__toast
})

const dimmingEnabled = computed(() => store.dimmingEnabled)
const toggleDimming = () => {
  store.toggleDimming()
}

const showGarland = computed(() => isNewYearPeriod())
</script>

<style>
@import '@/assets/main.scss';

#app {
  position: relative;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s;
}
.fade-enter,
.fade-leave-to {
  opacity: 0;
}

/* Затемняющий оверлей для обычного режима */
.dimming-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.8);
  z-index: 5;
}

/* Стиль для страницы с учетом мобильного хедера */
.router-view-container {
  padding-top: 0;
  padding-bottom: 50px;
  padding-left: 60px; /* место под фиксированный sidebar */
}

/* На мобильном sidebar скрыт — убираем отступ */
@media screen and (max-width: 768px) {
  .router-view-container {
    padding-left: 0;
  }
}

/* Отступ сверху для мобильного хедера */
.router-view-container--with-mobile-header {
  padding-top: 60px;
}

/* Дублируем через медиазапрос — на случай SSR когда isMobile ещё не вычислен */
@media screen and (max-width: 768px) {
  .router-view-container {
    padding-top: 60px;
  }
}

#garland {
  position: fixed;
  left: 0;
  bottom: 0;
  background-repeat: repeat-x;
  height: 34px;
  width: 100%;
  pointer-events: none;
  overflow: hidden;
  transform: rotate(180deg);
  z-index: 1;
}
</style>
