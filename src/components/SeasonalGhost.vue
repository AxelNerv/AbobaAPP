<template>
  <img v-if="theme.theme === 'halloween'" src="@/assets/halloween-ghost.svg" class="seasonal-ghost" alt="" aria-hidden="true" />
</template>
<script setup>
import { useThemeStore } from '@/store/theme'
const theme = useThemeStore()
</script>
<style scoped>
.seasonal-ghost { width: 54px; height: 60px; pointer-events: none; opacity: .74; animation: ghost-drift 7s ease-in-out infinite; }
@keyframes ghost-drift { 50% { transform: translateY(-4px) rotate(3deg); } }
@media (prefers-reduced-motion: reduce) { .seasonal-ghost { animation: none; } }
</style>
