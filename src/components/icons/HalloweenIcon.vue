<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="strokeWidth" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="halloween-icon">
    <g v-if="name === 'home'">
      <path d="m3 11 8-8 10 8M5 10v11h14V10M10 21v-6h4v6M8 10h1m6 0h1M16 5V2h3v6" />
      <path d="m6 17 2-1m8 1 2 1" stroke-opacity=".55" />
    </g>
    <g v-else-if="name === 'user'">
      <path d="M7 4h10v10c0 3-10 3-10 0ZM7 7l2-2 2 2 2-2 2 2 2-2M4 10h3m10 0h3M4 9v3m16-3v3M8 11h1m6 0h1M10 14h4m-2-1v2M5 22v-2c0-4 14-4 14 0v2" />
    </g>
    <g v-else-if="name === 'fingerprint'">
      <path d="M9 20v-4l-4-4c-1-2 1-3 2-2l2 2V5c0-2 3-2 3 0v5-7c0-2 3-2 3 0v7-5c0-2 3-2 3 0v8l2-3c1-1 3 0 2 2l-4 7v3M10 21h7M11 16l3-2m0 2-2-3M12 21v2m3-2v2" />
    </g>
    <g v-else-if="name === 'random'">
      <path d="M7 14c-5-5-2-11 5-11s10 6 5 11v4H7ZM9 11h.01m6-.01h.01M11 14h2M10 18v-2m4 2v-2M3 19l18 3M3 22l18-3" />
    </g>
    <g v-else-if="name === 'search'">
      <circle cx="10" cy="10" r="7" /><path d="m15 15 6 6M5 10s4-6 10 0c-6 6-10 0-10 0Z" /><circle cx="10" cy="10" r="1.2" />
    </g>
    <g v-else-if="name === 'settings'">
      <path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5M12 5l5 2 2 5-2 5-5 2-5-2-2-5 2-5Z" /><circle cx="12" cy="12" r="3" />
    </g>
    <g v-else-if="name === 'bell' || name === 'bellOff'">
      <path d="M10 4c0-2 3-3 4-2M12 5C3 1 2 17 7 18h10c5-1 4-17-5-13ZM8 10l2-2 1 3m2 0 1-3 2 2M8 14l4 2 4-2M10 21h4" /><path v-if="name === 'bellOff'" d="m3 3 18 18" />
    </g>
    <g v-else-if="name === 'heart'">
      <path d="M12 21 3 12C-2 5 7-1 12 6c5-7 14-1 9 6ZM13 6l-3 6 4 2-2 6M9 9l5 2m-5 3 6 2" />
    </g>
    <g v-else-if="name === 'movie' || name === 'series'">
      <rect x="3" y="7" width="18" height="14" rx="3" /><path d="m7 2 5 5 5-5M7 11h10v6H7Z" />
      <path v-if="name === 'movie'" d="m10 11 4 3-4 3" />
      <path v-else d="M6 4h1m10 0h1M9 21v2m6-2v2" />
    </g>
  </svg>
</template>
<script setup>
defineProps({ name: String, size: [Number, String], strokeWidth: [Number, String] })
</script>
