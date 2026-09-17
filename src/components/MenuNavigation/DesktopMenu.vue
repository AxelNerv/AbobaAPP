<template>
  <aside ref="sidebar" class="sidebar" :class="{ expanded: isSidebarOpen }" @keydown="onSidebarKeyDown">
    <!-- Логотип -->
    <div class="sidebar-logo" @click="toggleSidebar">
      <span class="logo-ab">Ab</span>
    </div>

    <nav class="sidebar-nav">
      <template v-for="(link, idx) in props.links" :key="link.text">
        <!-- Разделитель перед первым action-пунктом -->
        <div v-if="link.action && !props.links[idx - 1]?.action" class="sidebar-divider"></div>

        <!-- Action (без роута) -->
        <template v-if="link.action">
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
        tabindex="0"
        role="button"
        @click="toggleSearch"
        @keydown.enter.prevent="toggleSearch"
      >
        <span class="nav-icon"><AppIcon name="search" :size="17" /></span>
        <span class="nav-label">Поиск</span>
      </div>
    </nav>

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

const props = defineProps({ links: Array })

const route = useRoute()
const navbarStore = useNavbarStore()

const isSidebarOpen = ref(false)
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

// ── Пульт телевизора и стрелки ──
// Вверх/вниз — по пунктам панели, вправо — обратно к содержимому, туда,
// где фокус был до панели (обычно карточка фильма).
let lastContentFocus = null
const rememberContentFocus = (event) => {
  if (event.target?.closest?.('#main-content')) lastContentFocus = event.target
}

const onSidebarKeyDown = (event) => {
  const items = [...(sidebar.value?.querySelectorAll('.nav-item') || [])]
  const index = items.indexOf(document.activeElement)
  if (index === -1) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]
    next.focus()
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    event.stopPropagation()
    const target =
      (lastContentFocus?.isConnected && lastContentFocus) ||
      document.querySelector('#main-content .movie-card, #main-content input, #main-content button, #main-content a')
    target?.focus()
  }
}

const toggleSearch = () => {
  closeSidebar()
  navbarStore.openSearchModal()
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('focusin', rememberContentFocus)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('focusin', rememberContentFocus)
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
.sidebar:hover,
.sidebar:focus-within {
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
  /* Отступы внутри ширины: иначе меню и пункты шире панели,
     и подсветка выбранного пункта срезается её краем */
  box-sizing: border-box;
}

.sidebar-divider {
  width: calc(100% - 16px);
  height: 1px;
  background: rgba(255,255,255,0.06);
  margin: 6px 8px;
  flex-shrink: 0;
}

.nav-item,
.action-btn {
  box-sizing: border-box;
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
.sidebar:hover .nav-label,
.sidebar:focus-within .nav-label { opacity: 1; }

/* С пульта нужно видеть, какой пункт выбран. Рамка — внутренней тенью:
   обычный outline выходит за пункт, а панель обрезает всё за своим краем. */
.sidebar .nav-item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--accent-color);
  background: rgba(0, 229, 255, 0.1);
  color: var(--accent-color);
}

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
