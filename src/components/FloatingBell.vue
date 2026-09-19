<template>
  <div v-if="authStore.token || isDesktopApp" class="floating-bell-wrapper">
    <!-- Без входа колокольчик прячем, но об обновлении сообщить нужно всё равно -->
    <button
      v-if="authStore.token || hasPendingUpdate()"
      class="bell-btn"
      :class="{ 'has-unread': hasUnread }"
      :title="hasUnread ? `Уведомлений: ${notifications.length}` : 'Уведомления'"
      @click.stop="togglePopup"
    >
      <AppIcon name="bell" :size="20" />
      <span v-if="unreadBadge" class="badge">
        {{ unreadBadge }}
      </span>
    </button>

    <transition name="popup">
      <div v-if="isOpen" class="bell-popup" @click.stop>
        <div class="popup-header">
          <span>Уведомления</span>
          <div class="popup-header-actions">
            <button v-if="notifications.length" class="clear-btn" @click="clearAll">
              Очистить
            </button>
            <button class="close-btn" @click="isOpen = false">✕</button>
          </div>
        </div>
        <div class="popup-body">
          <div v-if="!notifications.length" class="state empty">
            Уведомлений пока нет
          </div>
          <div v-else class="notifs">
            <div
              v-for="n in notifications"
              :key="n.id"
              class="notif-item"
            >
              <div class="notif-text">{{ n.text }}</div>
              <template v-if="n.kind === 'update' && isActiveUpdate(n)">
                <button
                  class="update-btn"
                  :disabled="updateState.state === 'downloading'"
                  @click="installUpdate"
                >
                  {{ updateActionLabel() }}
                </button>
                <div v-if="updateState.state === 'error' && updateState.error" class="update-error">
                  {{ updateState.error }}
                </div>
              </template>
              <div class="notif-time">{{ formatTime(n.createdAt) }}</div>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- Настройки приложения: такой же кружок слева от колокольчика
         (row-reverse: в разметке после колокольчика, на экране — левее) -->
    <button
      v-if="isDesktopApp"
      class="bell-btn settings-btn"
      :class="{ active: navbarStore.isSettingsModalVisible }"
      title="Настройки"
      @click.stop="openSettings"
    >
      <AppIcon name="settings" :size="19" />
    </button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useAuthStore } from '@/store/auth'
import { useNavbarStore } from '@/store/navbar'
import {
  hasPendingUpdate,
  installUpdate,
  onUpdateState,
  startUpdateWatch,
  updateActionLabel,
  updateState
} from '@/utils/appUpdates'

const authStore = useAuthStore()
const navbarStore = useNavbarStore()
// Окно поверх страницы: переход на /settings закрывал фильм вместе с плеером.
const openSettings = () => {
  isOpen.value = false
  navbarStore.openSettingsModal()
}
const isDesktopApp = typeof window !== 'undefined' && !!window.electronAPI

const isOpen = ref(false)
const notifications = ref(loadNotifications())
const readIds = ref(loadReadIds())

function loadNotifications() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem('abobatv_notifications')
    return raw ? JSON.parse(raw) : []
  } catch (error) {
    console.warn('[notifications] локальная история повреждена:', error?.message || error)
    return []
  }
}
function saveNotifications() {
  try {
    window.localStorage.setItem('abobatv_notifications', JSON.stringify(notifications.value))
  } catch (error) {
    console.warn('[notifications] не удалось сохранить историю:', error?.message || error)
  }
}
function loadReadIds() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem('abobatv_notif_read')
    return raw ? JSON.parse(raw) : []
  } catch (error) {
    console.warn('[notifications] список прочитанных повреждён:', error?.message || error)
    return []
  }
}
function saveReadIds() {
  try {
    window.localStorage.setItem('abobatv_notif_read', JSON.stringify(readIds.value))
  } catch (error) {
    console.warn('[notifications] не удалось сохранить прочитанное:', error?.message || error)
  }
}

const addNotification = (text) => {
  const item = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    createdAt: Date.now()
  }
  notifications.value = [item, ...notifications.value].slice(0, 50)
  saveNotifications()
}

const unreadCount = computed(() => {
  return notifications.value.filter(n => !readIds.value.includes(n.id)).length
})
const hasUnread = computed(() => unreadCount.value > 0)
const unreadBadge = computed(() => {
  if (unreadCount.value === 0) return null
  return unreadCount.value > 99 ? '99+' : unreadCount.value
})

const togglePopup = () => {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    // Отмечаем все как прочитанные при открытии
    const allIds = notifications.value.map(n => n.id)
    readIds.value = Array.from(new Set([...readIds.value, ...allIds]))
    saveReadIds()
  }
}

const clearAll = () => {
  notifications.value = []
  readIds.value = []
  saveNotifications()
  saveReadIds()
}

const formatTime = (ts) => {
  if (!ts) return ''
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'только что'
  if (mins < 60) return `${mins} мин назад`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} ч назад`
  const days = Math.floor(hrs / 24)
  return `${days} д назад`
}

const handleClickOutside = (e) => {
  if (!isOpen.value) return
  const wrapper = document.querySelector('.floating-bell-wrapper')
  if (wrapper && !wrapper.contains(e.target)) {
    isOpen.value = false
  }
}

// ───────── Обновление приложения ─────────
// Одно уведомление на версию: повторные проверки раз в несколько часов
// не должны засыпать колокольчик одинаковыми сообщениями.
const isActiveUpdate = (n) => hasPendingUpdate() && n.version === updateState.version

const noteUpdate = (state) => {
  if (!hasPendingUpdate(state)) return
  const id = `update-${state.version}`
  if (notifications.value.some((n) => n.id === id)) return
  notifications.value = [
    { id, kind: 'update', version: state.version, text: `Доступно обновление AbobaTV ${state.version}`, createdAt: Date.now() },
    ...notifications.value
  ].slice(0, 50)
  saveNotifications()
}
let stopUpdateWatch = null

// ───────── Подгружаем глобальные уведомления от админа ─────────
let broadcastsPollId = null
const BROADCASTS_SEEN_KEY = 'abobatv_broadcasts_last_seen'
let lastBroadcastErrorAt = 0

const fetchBroadcasts = async () => {
  try {
    const { getBackendUrl } = await import('@/api/backendUrl')
    const lastSeen = window.localStorage.getItem(BROADCASTS_SEEN_KEY) || ''
    const url = lastSeen
      ? `${getBackendUrl()}/broadcasts/list?since=${encodeURIComponent(lastSeen)}`
      : `${getBackendUrl()}/broadcasts/list?limit=5`
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const items = data.broadcasts || []
    // Добавляем новые как уведомления
    let maxSeen = lastSeen
    for (const b of items.reverse()) {
      const already = notifications.value.some((n) => n.id === `broadcast-${b.id}`)
      if (already) continue
      const newItem = {
        id: `broadcast-${b.id}`,
        text: `📢 ${b.text}`,
        createdAt: new Date(b.created_at).getTime()
      }
      notifications.value = [newItem, ...notifications.value].slice(0, 50)
      if (b.created_at > maxSeen) maxSeen = b.created_at
    }
    if (maxSeen && maxSeen !== lastSeen) {
      window.localStorage.setItem(BROADCASTS_SEEN_KEY, maxSeen)
    }
    saveNotifications()
  } catch (error) {
    // Опрос идёт каждые 30 секунд: пишем в консоль не чаще раза в 5 минут.
    if (Date.now() - lastBroadcastErrorAt > 5 * 60 * 1000) {
      lastBroadcastErrorAt = Date.now()
      console.warn('[broadcasts] уведомления недоступны:', error?.message || error)
    }
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  // Регистрируем глобальную функцию добавления уведомления
  window.__addNotification = addNotification
  // Поллим глобальные уведомления от админа раз в 30 сек
  fetchBroadcasts()
  broadcastsPollId = setInterval(fetchBroadcasts, 60000)
  stopUpdateWatch = onUpdateState(noteUpdate)
  startUpdateWatch()
  noteUpdate(updateState)
})
onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  delete window.__addNotification
  if (broadcastsPollId) clearInterval(broadcastsPollId)
  stopUpdateWatch?.()
})
</script>

<style scoped>
.floating-bell-wrapper {
  position: fixed;
  top: 16px;
  right: 20px;
  z-index: 100;
  display: flex;
  flex-direction: row-reverse;
  align-items: flex-start;
  gap: 8px;
}
.settings-btn { box-sizing: border-box; }
.settings-btn.active {
  color: var(--accent-color);
  border-color: rgba(var(--accent-rgb), 0.55);
  background: rgba(var(--accent-rgb), 0.1);
}

.bell-btn {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(15, 20, 32, 0.85);
  border: 1px solid rgba(var(--accent-rgb), 0.25);
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(8px);
  transition: all 0.18s;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.bell-btn:hover {
  background: rgba(var(--accent-rgb), 0.1);
  border-color: rgba(var(--accent-rgb), 0.5);
  color: #fff;
}
.bell-btn i { font-size: 16px; }
.bell-btn.has-unread i { color: var(--accent-color); }

.badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #ff5e8a;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--bg-primary);
}

.bell-popup {
  position: absolute;
  top: 50px;
  right: 0;
  width: 320px;
  background: rgba(10, 12, 24, 0.98);
  border: 1px solid rgba(var(--accent-rgb), 0.22);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(14px);
  overflow: hidden;
}
.popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}
.popup-header-actions { display: flex; gap: 8px; align-items: center; }
.clear-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.35);
  cursor: pointer;
  font-size: 11px;
  padding: 0;
  transition: color 0.15s;
}
.clear-btn:hover { color: var(--accent-color); }
.close-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  font-size: 13px;
  padding: 0 4px;
  line-height: 1;
  transition: color 0.15s;
}
.close-btn:hover { color: #fff; }

.popup-body {
  max-height: 360px;
  overflow-y: auto;
}
.state {
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
}

.notifs { display: flex; flex-direction: column; }
.notif-item {
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.notif-item:last-child { border-bottom: none; }
.notif-text {
  font-size: 12px;
  color: #fff;
  line-height: 1.4;
  margin-bottom: 4px;
}
.notif-time {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
}
.update-btn {
  margin: 4px 0 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(var(--accent-rgb), 0.35);
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent-color, #00e5ff);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.update-btn:disabled {
  opacity: 0.7;
  cursor: default;
}
.update-error {
  font-size: 11px;
  color: #ff8aa8;
  margin-bottom: 4px;
}

.popup-enter-active,
.popup-leave-active {
  transition: opacity 0.16s, transform 0.16s;
}
.popup-enter-from,
.popup-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}
</style>
