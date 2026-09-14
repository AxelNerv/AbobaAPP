<template>
  <transition name="slide">
    <nav v-if="isNavbarVisible" class="mobile-navbar" @click.stop>
      <div class="nav-links-wrapper">
        <ul class="nav-links">
          <li v-for="link in props.links" :key="link.text">
            <template v-if="link.component === 'NotificationBadge'">
              <router-link
                :to="link.to"
                :exact="link.exact"
                class="notification-link"
                @click="closeNavbar"
              >
                <NotificationBadge />
                <span class="menu-text">{{ link.text }}</span>
              </router-link>
            </template>

            <!-- Кнопка с action (случайный фильм, поиск по ID и т.д.) -->
            <button
              v-else-if="link.action"
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
import NotificationBadge from '@/components/notification/NotificationBadge.vue'

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
  background: rgba(30, 30, 30, 0.97);
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
  color: rgba(255, 255, 255, 0.8);
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
  background: rgba(0, 229, 255, 0.1);
  color: var(--accent-color);
}

.menu-text {
  width: 130px;
  display: inline-block;
}

.nav-links a:hover {
  background: var(--accent-transparent, rgba(108, 92, 231, 0.15));
  color: var(--accent-color, #6c5ce7);
  border-left: 3px solid var(--accent-color, #6c5ce7);
  transform: translateX(3px);
}

.nav-links a:active,
.nav-links a.router-link-active {
  background: rgba(0, 229, 255, 0.12);
  color: var(--accent-color, #9d4edd);
  border-left: 3px solid var(--accent-color, #9d4edd);
  box-shadow: inset 0 0 16px rgba(0, 229, 255, 0.15);
  text-shadow: 0 0 8px rgba(0, 229, 255, 0.6);
}

.notification-link {
  display: flex;
  align-items: center;
  gap: 1rem;
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  padding: 10px 20px;
  transition: all 0.3s ease;
  min-width: 250px;
}

.notification-link:hover {
  background: rgba(0, 229, 255, 0.1);
  color: var(--accent-color, #9d4edd);
  border-left: 3px solid var(--accent-color, #9d4edd);
  transform: translateX(3px);
}

.notification-link:active,
.notification-link.router-link-active {
  background: rgba(0, 229, 255, 0.12);
  color: var(--accent-color, #9d4edd);
  border-left: 3px solid var(--accent-color, #9d4edd);
  box-shadow: inset 0 0 16px rgba(0, 229, 255, 0.15);
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
