<template>
  <div class="toggle-wrapper">
    <button class="toggle" @click="toggle">
      <AppIcon
        :name="navbarStore.isNavbarVisible ? 'close' : 'menu'"
        :size="22"
        :class="{ animate: animate }"
      />
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useNavbarStore } from '@/store/navbar'

const navbarStore = useNavbarStore()
const animate = ref(false)

function toggle() {
  // Запускаем анимацию перед переключением иконки
  animate.value = true
  // Используем небольшой timeout для анимации (например, 150 мс)
  setTimeout(() => {
    navbarStore.toggleNavbar()
    // Сбрасываем флаг анимации
    animate.value = false
  }, 150)
}
</script>

<style scoped>
.toggle-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.toggle {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 30px;
  margin: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none;
  transition: transform 0.3s ease;
  z-index: 6;
  color: #fff;
}


/* Базовая анимация для иконки */
.toggle i {
  transition:
    transform 0.3s ease,
    opacity 0.3s ease;
}

/* При добавлении класса .animate можно задать эффект, например, увеличение или небольшое вращение */
.animate {
  transform: scale(1.2);
  opacity: 0.7;
}

@keyframes bounce-in {
  0% {
    transform: scale(0);
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
  }
}

.menu-icon.active {
  background: var(--accent-color);
  transform: scale(1.1);
}
</style>
