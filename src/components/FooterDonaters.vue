<template>
  <footer :class="{ 'footer-fixed': !isAtBottom, 'footer-static': isAtBottom }">
    <div class="footer-wrapper">
      <span class="footer-text">AbobaTV &mdash; онлайн просмотр фильмов и сериалов</span>
    </div>
  </footer>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const isAtBottom = ref(false)

let scrollTimeout = null
const handleScroll = () => {
  if (scrollTimeout) return
  scrollTimeout = window.requestAnimationFrame(() => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop
    const windowHeight = window.innerHeight
    const documentHeight = document.documentElement.scrollHeight
    isAtBottom.value = scrollTop + windowHeight >= documentHeight - 10
    scrollTimeout = null
  })
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true })
  handleScroll()
})

onUnmounted(() => {
  if (scrollTimeout) window.cancelAnimationFrame(scrollTimeout)
  window.removeEventListener('scroll', handleScroll)
})
</script>

<style scoped>
footer {
  width: 100%;
  background: rgba(0, 0, 0, 0.85);
  z-index: 1000;
  transition: all 0.3s ease;
}

.footer-fixed {
  position: fixed;
  bottom: 0;
  left: 0;
}

.footer-static {
  position: absolute;
  bottom: 0;
  left: 0;
}

.footer-wrapper {
  height: 36px;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0 20px;
}

.footer-text {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 0.3px;
}
</style>
