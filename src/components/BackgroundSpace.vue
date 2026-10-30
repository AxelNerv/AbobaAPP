<template>
  <div v-if="theme.theme === 'halloween'" class="seasonal-details" aria-hidden="true">
    <div class="background-lights">
      <i class="warm-light light-porch"></i><i class="warm-light light-pumpkin"></i>
      <i class="warm-light light-step"></i><i class="warm-light light-right"></i>
      <i class="warm-light light-moon"></i>
    </div>
    <svg class="corner-web" viewBox="0 0 180 180" fill="none">
      <path d="M0 0L172 8M0 0L159 59M0 0L125 118M0 0L64 159M0 0L8 175M0 0L174 174M0 27Q15 12 28 2M0 56Q14 36 28 32Q43 21 56 3M0 91Q25 64 45 57Q68 43 88 4M0 128Q28 96 62 82Q97 62 125 6M0 167Q43 127 81 107Q133 88 166 8M28 32Q26 45 45 57M45 57Q43 75 62 82M62 82Q58 101 81 107M45 57Q59 58 64 64M62 82Q86 79 90 90M81 107Q105 104 119 119M28 32Q30 26 32 28M64 64Q55 70 57 77M90 90Q79 92 82 111M119 119Q104 126 108 139M57 77Q43 79 42 103M82 111Q66 115 63 144M108 139Q86 143 84 169" />
    </svg>
  </div>
</template>

<script setup>
import { useThemeStore } from '@/store/theme'
const theme = useThemeStore()
</script>

<style scoped>
.seasonal-details { position: fixed; inset: 0; z-index: 1; pointer-events: none; overflow: hidden; }
.corner-web { position: absolute; top: 0; left: 60px; width: clamp(90px, 12vw, 170px); color: #d4b4c3; stroke: currentColor; stroke-width: .7; opacity: .12; }
.background-lights { position: absolute; left: 50%; top: 50%; width: max(100vw, calc(100vh * 1.77683)); height: max(100vh, calc(100vw * .5628)); transform: translate(-50%, -50%); }
.warm-light { position: absolute; width: 5%; aspect-ratio: 1; transform: translate(-50%, -50%); background: radial-gradient(ellipse, #efb65a28, #c5764512 35%, transparent 70%); animation: candle-glow 6s ease-in-out infinite; }
.light-porch { left: 10.5%; top: 32%; }
.light-pumpkin { left: 10.5%; top: 70%; animation-delay: -2s; }
.light-step { left: 15.2%; top: 80%; animation-delay: -4s; }
.light-right { left: 96%; top: 79%; animation-delay: -1s; }
.light-moon { left: 90.5%; top: 10.6%; width: 10%; background: radial-gradient(ellipse, #dac4a719, transparent 65%); animation-duration: 10s; }
@keyframes candle-glow { 0%, 100% { opacity: .35; } 40% { opacity: .8; } 65% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) { .warm-light { animation: none; opacity: .45; } }
@media (max-width: 768px) { .corner-web { left: 0; opacity: .08; width: 90px; } }
</style>
