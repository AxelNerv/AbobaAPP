<template>
  <aside ref="sidebar" class="sidebar" :class="{ expanded: isSidebarOpen }">
    <!-- Логотип -->
    <div class="sidebar-logo" @click="toggleSidebar">
      <span class="logo-ab">Ab</span>
    </div>

    <nav class="sidebar-nav">
      <template v-for="(link, idx) in props.links" :key="link.text">
        <!-- Разделитель перед первым action-пунктом -->
        <div v-if="link.action && !props.links[idx - 1]?.action" class="sidebar-divider"></div>

        <!-- NotificationBadge -->
        <template v-if="link.component === 'NotificationBadge'">
          <router-link
            :to="link.to"
            :exact="link.exact"
            class="nav-item notification-link"
            :title="link.text"
            @click="closeSidebar"
          >
            <span class="nav-icon"><NotificationBadge /></span>
            <span class="nav-label">{{ link.text }}</span>
          </router-link>
        </template>

        <!-- Action (без роута) -->
        <template v-else-if="link.action">
          <button
            type="button"
            class="nav-item action-btn"
            :title="link.text"
            @click="link.action(); closeSidebar()"
          >
            <span class="nav-icon">
              <AppIcon v-if="typeof link.icon === 'string' && !link.icon.startsWith('http')" :name="link.icon" :size="17" />
              <img v-else-if="typeof link.icon === 'string' && link.icon.startsWith('https://')" :src="link.icon" :alt="link.text" class="icon-user" />
              <img v-else src="@/assets/icon-donut.png" :alt="link.text" class="icon-donut" />
            </span>
            <span class="nav-label">{{ link.text }}</span>
          </button>
        </template>

        <!-- Обычная ссылка -->
        <template v-else>
          <component
            :is="link.to ? 'router-link' : 'a'"
            v-bind="link.to ? { to: link.to, exact: link.exact } : { href: link.href, target: '_blank' }"
            class="nav-item"
            :title="link.text"
            @click="closeSidebar"
          >
            <span class="nav-icon">
              <AppIcon v-if="typeof link.icon === 'string' && !link.icon.startsWith('http')" :name="link.icon" :size="17" />
              <img v-else-if="typeof link.icon === 'string' && link.icon.startsWith('https://')" :src="link.icon" :alt="link.text" class="icon-user" />
              <img v-else src="@/assets/icon-donut.png" :alt="link.text" class="icon-donut" />
            </span>
            <span class="nav-label">{{ link.text }}</span>
          </component>
        </template>
      </template>

      <!-- Поиск (не на главной) -->
      <div
        v-if="route.name !== 'home'"
        class="nav-item"
        title="Поиск (Ctrl+F)"
        @click="toggleSearch"
      >
        <span class="nav-icon"><AppIcon name="search" :size="17" /></span>
        <span class="nav-label">Поиск</span>
      </div>
    </nav>

    <!-- Настройки — внизу панели. Только в приложении: на сайте настраивать нечего. -->
    <div v-if="isDesktopApp" class="sidebar-bottom">
      <router-link to="/settings" class="nav-item" title="Настройки" @click="closeSidebar">
        <span class="nav-icon"><AppIcon name="settings" :size="17" /></span>
        <span class="nav-label">Настройки</span>
      </router-link>
    </div>

    <!-- Tooltip в свёрнутом виде -->
    <div v-if="!isSidebarOpen && activeTooltip !== null" class="tooltip" :style="tooltipStyle">
      {{ tooltipText }}
    </div>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useRoute } from 'vue-router'
import { useNavbarStore } from '@/store/navbar'
import NotificationBadge from '@/components/notification/NotificationBadge.vue'

const props = defineProps({ links: Array })

const route = useRoute()
const navbarStore = useNavbarStore()

const isSidebarOpen = ref(false)
const isDesktopApp = typeof window !== 'undefined' && !!window.electronAPI
const sidebar = ref(null)

const toggleSidebar = () => { isSidebarOpen.value = !isSidebarOpen.value }
const closeSidebar = () => { isSidebarOpen.value = false }

let clickOutsideTimeout = null
const handleClickOutside = (e) => {
  if (clickOutsideTimeout) return
  clickOutsideTimeout = window.requestAnimationFrame(() => {
    if (sidebar.value && !sidebar.value.contains(e.target) && isSidebarOpen.value) {
      isSidebarOpen.value = false
    }
    clickOutsideTimeout = null
  })
}

const activeTooltip = ref(null)
const tooltipPosition = ref({ x: 0, y: 0 })
const tooltipText = ref('')
let tooltipTimeout = null
const tooltipStyle = computed(() => ({
  left: `${tooltipPosition.value.x}px`,
  top: `${tooltipPosition.value.y}px`
}))

const toggleSearch = () => {
  closeSidebar()
  navbarStore.openSearchModal()
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  if (clickOutsideTimeout) window.cancelAnimationFrame(clickOutsideTimeout)
  if (tooltipTimeout) clearTimeout(tooltipTimeout)
})
</script>

<style lang="scss" scoped>
.sidebar {
  position: fixed;
  left: 0; top: 0; bottom: 0;
  width: 60px;
  background: linear-gradient(180deg, #090e1c 0%, #07090f 100%);
  border-right: 1px solid rgba(0,229,255,0.07);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 0;
  z-index: 100;
  transition: width 0.28s cubic-bezier(.4,0,.2,1);
  overflow: hidden;
  box-shadow: 4px 0 24px rgba(0,0,0,0.4);
}
@media screen and (max-width: 600px) {
  .sidebar { display: none !important; }
}
.sidebar.expanded,
.sidebar:hover {
  width: 210px;
}

.sidebar-logo {
  width: 38px; height: 38px;
  background: linear-gradient(135deg, #00e5ff, #00b8d4);
  border-radius: 11px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 900; font-size: 15px; color: #000;
  margin-bottom: 24px; flex-shrink: 0;
  box-shadow: 0 0 16px rgba(0,229,255,0.3);
  cursor: pointer;
  letter-spacing: -1px;
  transition: box-shadow 0.2s;
  &:hover { box-shadow: 0 0 24px rgba(0,229,255,0.5); }
}
.logo-ab { font-family: 'Inter', sans-serif; font-weight: 900; }

.sidebar-nav {
  display: flex; flex-direction: column;
  gap: 2px; width: 100%; padding: 0 8px; flex: 1;
}

.sidebar-bottom {
  width: 100%;
  padding: 8px 8px 0;
  border-top: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
}

.sidebar-divider {
  width: calc(100% - 16px);
  height: 1px;
  background: rgba(255,255,255,0.06);
  margin: 6px 8px;
  flex-shrink: 0;
}

.nav-item,
.action-btn,
.notification-link {
  display: flex; align-items: center;
  gap: 13px;
  padding: 10px 8px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.18s;
  white-space: nowrap;
  color: rgba(232,234,240,0.42);
  min-height: 42px;
  text-decoration: none;
  border: none;
  background: none;
  width: 100%;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: left;

  &:hover {
    background: rgba(0, 229, 255, 0.08);
    color: var(--accent-color);
    .nav-icon .app-icon, .nav-icon { filter: drop-shadow(0 0 5px rgba(0, 229, 255, 0.4)); }
  }

  &.router-link-active {
    background: rgba(0, 229, 255, 0.1);
    color: var(--accent-color);
    .nav-icon .app-icon { filter: drop-shadow(0 0 6px rgba(0, 229, 255, 0.5)); }
  }
}

.nav-icon {
  width: 26px; height: 26px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px;
}

.nav-label {
  font-size: 13px; font-weight: 500;
  opacity: 0;
  transition: opacity 0.18s;
  pointer-events: none;
}
.sidebar.expanded .nav-label,
.sidebar:hover .nav-label { opacity: 1; }

.icon-user {
  height: 22px; width: 22px;
  object-fit: contain; border-radius: 50%;
}
.icon-donut { height: 22px; object-fit: contain; }

.tooltip {
  position: fixed;
  background: rgba(15,20,32,0.95);
  border: 1px solid rgba(0,229,255,0.2);
  color: var(--text-color);
  padding: 5px 10px;
  border-radius: 7px;
  white-space: nowrap;
  font-size: 12px;
  pointer-events: none;
  z-index: 200;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
</style>
