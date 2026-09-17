<template>
  <!-- Настройки поверх текущей страницы: фильм и плеер под окном не закрываются -->
  <div class="settings-modal" @click="close">
    <div class="settings-modal__content" role="dialog" aria-label="Настройки" @click.stop>
      <button class="settings-modal__close" aria-label="Закрыть" @click="close">
        <AppIcon name="close" :size="16" />
      </button>
      <div class="settings-modal__scroll">
        <ShareWifi embedded />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import ShareWifi from '@/components/ShareWifi.vue'
import { useNavbarStore } from '@/store/navbar'

const navbarStore = useNavbarStore()
const close = () => navbarStore.closeSettingsModal()

const onKeyDown = (event) => {
  if (event.key === 'Escape') close()
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<style scoped>
.settings-modal {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.settings-modal__content {
  position: relative;
  width: 100%;
  max-width: 1120px;
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  background: rgba(10, 12, 24, 0.97);
  border: 1px solid rgba(0, 229, 255, 0.22);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 229, 255, 0.08);
}

.settings-modal__scroll {
  overflow-y: auto;
  padding: 24px 26px 26px;
}

.settings-modal__close {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 1;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.settings-modal__close:hover {
  background: rgba(0, 229, 255, 0.12);
  color: #fff;
}

@media (max-width: 600px) {
  .settings-modal { padding: 8px; }
  .settings-modal__scroll { padding: 18px 14px; }
}
</style>
