<template>
  <div class="spinner-wrapper" role="status" aria-label="Загрузка">
    <img src="@/assets/icon-spinner.svg" alt="" aria-hidden="true" class="spinner spinner--classic" />
    <img src="@/assets/halloween-loading-pumpkin.svg" alt="" aria-hidden="true" class="spinner spinner--pumpkin" />
    <p v-if="text" class="spinner-text">{{ text }}</p>
  </div>
</template>

<script setup>
defineProps({
  loading: {
    type: Boolean,
    default: false
  },
  text: {
    type: String,
    default: ''
  }
})
</script>

<style scoped>
.spinner-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  pointer-events: none;
  min-height: 100%;
}

.spinner {
  width: 70px;
  height: 70px;
  animation: spin 1s linear infinite;
  pointer-events: none;
}

.spinner-text {
  margin-top: 15px;
  color: #fff;
  font-size: 14px;
  text-align: center;
}

.spinner--pumpkin { display: none; }
:global(html[data-theme='halloween'] .spinner--classic) { display: none; }
:global(html[data-theme='halloween'] .spinner--pumpkin) {
  display: block;
  animation: pumpkin-breathe 2.8s ease-in-out infinite;
}

@keyframes pumpkin-breathe {
  0%, 100% { transform: translateY(2px) rotate(-3deg); opacity: .76; }
  50% { transform: translateY(-3px) rotate(3deg); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .spinner,
  :global(html[data-theme='halloween'] .spinner--pumpkin) { animation: none; }
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
