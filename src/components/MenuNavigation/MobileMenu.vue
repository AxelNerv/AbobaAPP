<template>
  <transition name="slide">
    <nav v-if="isNavbarVisible" class="mobile-navbar" @click.stop>
      <div class="nav-links-wrapper">
        <ul class="nav-links">
          <li v-for="link in props.links" :key="link.text">
            <!-- Кнопка с action (случайный фильм, поиск по ID и т.д.) -->
            <button
              v-if="link.action"
              class="action-link"
              @click="handleAction(link)"
            >
              <template v-if="typeof link.icon === 'string' && !link.icon.startsWith('http')">
                <AppIcon :name="link.icon" :size="18" />
              </template>
              <template
                v-else-if="typeof link.icon === 'string' && link.icon.startsWith('https://')"
              >
                <img :src="link.icon" alt="icon" class="icon-user" />
              </template>
              <span class="menu-text">{{ link.text }}</span>
            </button>

            <component
              :is="link.to ? 'router-link' : 'a'"
              v-else
              v-bind="
                link.to ? { to: link.to, exact: link.exact } : { href: link.href, target: '_blank' }
              "
              @click="closeNavbar"
            >
              <template v-if="typeof link.icon === 'string' && !link.icon.startsWith('http')">
                <AppIcon :name="link.icon" :size="18" />
              </template>
              <template
                v-else-if="typeof link.icon === 'string' && link.icon.startsWith('https://')"
              >
                <img :src="link.icon" alt="icon" class="icon-user" />
              </template>
              <template v-else>
                <img src="@/assets/icon-donut.png" alt="icon" class="icon-donut" />
              </template>
              <span class="menu-text">{{ link.text }}</span>
            </component>
          </li>
        </ul>
      </div>
    </nav>
  </transition>

  <div v-if="isNavbarVisible" class="overlay" @click="closeNavbar"></div>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useNavbarStore } from '@/store/navbar'

const props = defineProps({
  links: Array
})

const navbarStore = useNavbarStore()
const { isNavbarVisible } = storeToRefs(navbarStore)
const { closeNavbar } = navbarStore

const handleAction = (link) => {
  if (typeof link.action === 'function') {
    link.action()
  }
  closeNavbar()
}
</script>

<style scoped>
/* Стили для мобильного меню и оверлея */
.mobile-navbar {
  position: fixed;
  left: 0;
  width: 250px;
  height: 100vh;
  /* Те же цвета, что у боковой панели на компьютере (DesktopMenu) */
  background: linear-gradient(180deg, #090e1c 0%, #07090f 100%);
  border-right: 1px solid rgba(var(--accent-rgb), 0.07);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
  padding-top: 60px;
  z-index: 5;
}

.nav-links-wrapper {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 1rem;
  height: calc(100vh - 60px);
}

.nav-links {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.nav-links li {
  width: 100%;
  position: relative;
}

.nav-links a,
.nav-links button {
  display: flex;
  align-items: center;
  gap: 1rem;
  color: rgba(232, 234, 240, 0.6);
  text-decoration: none;
  padding: 10px 20px;
  transition: all 0.3s ease;
  min-width: 250px;
}

.nav-links button.action-link {
  background: none;
  border: none;
  cursor: pointer;
  width: 100%;
  text-align: left;
  font: inherit;
  font-size: inherit;
}

/* .app-icon вместо i — иконки теперь SVG, старый селектор не совпадал */
.nav-links a .app-icon,
.nav-links a img,
.nav-links button .app-icon,
.nav-links button img {
  width: 25px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.nav-links button.action-link:hover {
  background: rgba(var(--accent-rgb), 0.1);
  color: var(--accent-color);
}

.menu-text {
  width: 130px;
  display: inline-block;
}

.nav-links a:hover {
  background: rgba(var(--accent-rgb), 0.08);
  color: var(--accent-color);
}

.nav-links a:active,
.nav-links a.router-link-active {
  background: rgba(var(--accent-rgb), 0.1);
  color: var(--accent-color);
}


.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(-100%);
}

.overlay {
  position: fixed;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.5);
  z-index: 4;
}

.icon-donut {
  height: 25px;
  object-fit: contain;
  width: 25px;
}

.icon-user {
  height: 25px;
  width: 25px;
  object-fit: contain;
  border-radius: 50%;
}
</style>
