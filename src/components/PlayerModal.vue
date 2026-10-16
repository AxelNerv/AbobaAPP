<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="player-dialog"
      :aria-labelledby="titleId"
      aria-modal="true"
      @cancel.prevent="emit('close')"
      @keydown.esc.stop.prevent="emit('close')"
      @click="onBackdropClick"
    >
      <header class="dialog-header">
        <div class="dialog-heading">
          <h2 :id="titleId">Источники видео</h2>
          <p>{{ movieTitle || 'Выберите плеер для просмотра' }}</p>
        </div>
        <button
          type="button"
          class="close-button"
          aria-label="Закрыть выбор источника"
          @click="emit('close')"
        >
          <AppIcon name="close" :size="20" />
        </button>
      </header>

      <ul v-if="players.length" class="source-options" aria-label="Доступные плееры">
        <li v-for="player in players" :key="player.key">
          <button
            type="button"
            class="player-item"
            :class="{ selected: isSelected(player) }"
            :aria-pressed="isSelected(player)"
            :data-player-key="player.key"
            @click="selectPlayer(player)"
          >
            <span class="source-icon"><AppIcon name="screen" :size="20" /></span>
            <span class="source-copy">
              <span class="source-name"
                >{{ playerLabel(player) }}
                <span v-if="player.uhd" class="quality-badge">4K</span></span
              >
              <span class="source-description">{{ playerDescription(player) }}</span>
            </span>
            <span v-if="isSelected(player)" class="selection-mark"
              ><span>Выбран</span><AppIcon name="check" :size="18"
            /></span>
            <AppIcon v-else-if="player.warning" name="warning" :size="18" class="warning-icon" />
            <AppIcon v-else name="forward" :size="17" class="option-arrow" />
          </button>
        </li>
      </ul>
      <p v-else class="empty-state" role="status">Для этого фильма пока нет доступных плееров.</p>
      <footer>Если видео не запускается, попробуйте другой источник.</footer>
    </dialog>
  </Teleport>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps({
  players: { type: Array, required: true },
  selectedPlayer: { type: Object, default: null },
  movieTitle: { type: String, default: '' }
})
const emit = defineEmits(['close', 'select'])
const dialog = ref(null)
const titleId = useId()
let previousFocus = null
let previousOverflow = ''

const playerLabel = (player) => {
  const provider = String(player.provider || '').trim()
  if (provider) return provider
  const parts = String(player.name || player.key || '')
    .split('>')
    .filter(Boolean)
  return /^(KINOBOX|KINOBD|RHSERV)$/i.test(parts[0]) ? parts[1] || 'Плеер' : parts[0] || 'Плеер'
}

const playerDescription = (player) => {
  const translation = String(player.translate || '').trim()
  if (translation && translation.toLowerCase() !== playerLabel(player).toLowerCase())
    return translation
  const descriptions = {
    turbo: 'Основной плеер',
    collaps: 'Альтернативный видеопоток',
    veoveo: 'Дополнительный источник'
  }
  return descriptions[playerLabel(player).toLowerCase()] || 'Другой вариант просмотра'
}

const isSelected = (player) => props.selectedPlayer?.key === player.key
const selectPlayer = (player) => {
  emit('select', player)
  emit('close')
}
const onBackdropClick = (event) => {
  if (event.target !== dialog.value) return
  const box = dialog.value.getBoundingClientRect()
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
    emit('close')
}

onMounted(() => {
  previousFocus = document.activeElement
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  dialog.value.showModal()
  dialog.value.querySelector('[aria-pressed="true"]')?.focus()
})

onBeforeUnmount(() => {
  dialog.value?.close()
  document.body.style.overflow = previousOverflow
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<style scoped>
.player-dialog {
  box-sizing: border-box;
  width: min(440px, calc(100vw - 32px));
  max-width: none;
  max-height: calc(100dvh - 48px);
  margin: auto;
  padding: 0;
  overflow: auto;
  color: var(--text-color);
  background: var(--bg-modal);
  border: 1px solid var(--border-hover);
  border-radius: 18px;
  box-shadow: 0 24px 80px rgb(0 0 0 / 45%);
  color-scheme: dark;
}
.player-dialog::backdrop {
  background: rgb(0 0 0 / 55%);
  backdrop-filter: blur(2px);
}
.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 16px 16px 24px;
}
.dialog-heading {
  min-width: 0;
}
h2 {
  margin: 2px 0 6px;
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.025em;
}
.dialog-heading p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.close-button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  margin-top: -4px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.close-button:hover {
  color: var(--text-color);
  background: var(--bg-card);
}
.source-options {
  display: grid;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0 16px;
}
.player-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 76px;
  padding: 12px;
  box-sizing: border-box;
  text-align: left;
  color: var(--text-color);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  cursor: pointer;
  transition:
    border-color 160ms,
    background-color 160ms;
}
.player-item:hover {
  border-color: var(--border-hover);
  background: rgba(var(--accent-rgb), 0.05);
}
.player-item.selected {
  border-color: var(--accent-color);
  background: rgba(var(--accent-rgb), 0.07);
}
.source-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-secondary);
}
.selected .source-icon {
  color: var(--accent-color);
  border-color: rgba(var(--accent-rgb), 0.2);
}
.source-copy {
  display: grid;
  gap: 5px;
  flex: 1;
  min-width: 0;
}
.source-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.source-description {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.selection-mark {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--accent-color);
}
.option-arrow {
  color: var(--text-secondary);
  flex-shrink: 0;
}
.quality-badge {
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 10px;
  color: var(--accent-color);
  background: rgba(var(--accent-rgb), 0.12);
}
.warning-icon {
  color: var(--warning-color);
  flex-shrink: 0;
}
footer {
  padding: 16px 24px 20px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.empty-state {
  padding: 12px 24px;
  color: var(--text-secondary);
}
button:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 3px;
}
@media (max-width: 480px) {
  .dialog-header {
    padding-left: 20px;
  }
  h2 {
    font-size: 19px;
  }
  .source-options {
    padding: 0 12px;
  }
  .selection-mark span {
    display: none;
  }
  .player-item {
    gap: 10px;
  }
  footer {
    padding-left: 20px;
    padding-right: 20px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .player-item {
    transition: none;
  }
}
</style>
