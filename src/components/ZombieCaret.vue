<template>
  <span v-show="visible" ref="caret" class="zombie-caret" :class="{ 'zombie-caret--walking': walking }" :style="position" aria-hidden="true">
    <svg width="14" height="22" viewBox="0 0 14 22" fill="none">
      <path d="M4 2h7v7H4Z" fill="#a3b78e" stroke="#d1d8b5" stroke-width=".6" />
      <path d="M4 3V1h7v3L9 2 7 3 5 2Z" fill="#59614f" />
      <path d="M6 5h.5m3 0h.5M8 7h2" stroke="#2d302a" stroke-linecap="round" />
      <path d="M5 10h5l1 6H4Z" fill="#7e6676" stroke="#ae8d95" stroke-width=".6" />
      <g class="zombie-arm"><path d="m5 11-3 2H.5M10 11l2 1h1" stroke="#a3b78e" stroke-width="1.5" stroke-linecap="round" /></g>
      <path class="zombie-leg zombie-leg--left" d="m6 16-1 4H3" stroke="#b2a18c" stroke-width="2" stroke-linecap="round" />
      <path class="zombie-leg zombie-leg--right" d="m9 16 1 4h2" stroke="#8d9b7d" stroke-width="2" stroke-linecap="round" />
    </svg>
  </span>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useThemeStore } from '@/store/theme'

const props = defineProps({ input: { type: Object, default: null }, value: { type: String, default: '' } })
const theme = useThemeStore()
const enabled = computed(() => theme.theme === 'halloween')
const caret = ref(null)
const visible = ref(false)
const walking = ref(false)
const position = ref({})
let composing = false
let walkTimer
let observer
let currentInput
let context

const hide = () => {
  visible.value = false
  walking.value = false
  clearTimeout(walkTimer)
  currentInput?.classList.remove('zombie-caret-native-hidden')
}
const update = () => {
  const input = currentInput
  if (!input || !enabled.value || composing || document.activeElement !== input ||
      input.selectionStart == null || input.selectionStart !== input.selectionEnd) { hide(); return }
  const style = window.getComputedStyle(input)
  // Keep the native caret for RTL, selection, IME and unsupported measurements.
  if (style.direction === 'rtl') { hide(); return }
  context ||= document.createElement('canvas').getContext('2d')
  if (!context) { hide(); return }
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const text = input.value.slice(0, input.selectionStart)
  const rect = input.getBoundingClientRect()
  const parent = caret.value?.parentElement?.getBoundingClientRect()
  if (!parent) { hide(); return }
  const padding = parseFloat(style.paddingLeft) || 0
  const x = padding + (parseFloat(style.borderLeftWidth) || 0) + context.measureText(text).width +
    (parseFloat(style.letterSpacing) || 0) * [...text].length - input.scrollLeft
  const right = rect.width - (parseFloat(style.paddingRight) || 0)
  if (x < padding || x + 14 > right) { hide(); return }
  position.value = { left: `${rect.left - parent.left + x + 1}px`, top: `${rect.top - parent.top + rect.height / 2}px` }
  visible.value = true
  input.classList.add('zombie-caret-native-hidden')
}
const onInput = () => {
  clearTimeout(walkTimer)
  walking.value = true
  walkTimer = setTimeout(() => { walking.value = false }, 260)
  void nextTick(update)
}
const compositionStart = () => { composing = true; hide() }
const compositionEnd = () => { composing = false; onInput() }
const events = {
  focus: update, blur: hide, input: onInput, keyup: update, click: update,
  select: update, scroll: update, compositionstart: compositionStart, compositionend: compositionEnd
}
const detach = () => {
  hide()
  if (currentInput) for (const [event, listener] of Object.entries(events)) currentInput.removeEventListener(event, listener)
  observer?.disconnect()
  currentInput = null
  window.removeEventListener('resize', update)
}
watch(() => props.input, input => {
  detach()
  currentInput = input
  if (!input) return
  for (const [event, listener] of Object.entries(events)) input.addEventListener(event, listener)
  if (window.ResizeObserver) { observer = new ResizeObserver(update); observer.observe(input) }
  window.addEventListener('resize', update)
  void nextTick(update)
}, { flush: 'post', immediate: true })
watch([enabled, () => props.value], () => void nextTick(update))
onBeforeUnmount(() => { detach(); clearTimeout(walkTimer) })
</script>

<style scoped>
.zombie-caret { position: absolute; z-index: 6; width: 14px; height: 22px; transform: translateY(-50%); pointer-events: none; }
.zombie-caret svg { display: block; }
:global(.zombie-caret-native-hidden) { caret-color: transparent !important; }
.zombie-leg, .zombie-arm { transform-box: fill-box; transform-origin: top center; }
.zombie-caret--walking .zombie-leg { animation: zombie-step 220ms ease-in-out infinite alternate; }
.zombie-caret--walking .zombie-leg--right { animation-direction: alternate-reverse; }
.zombie-caret--walking .zombie-arm { animation: zombie-reach 220ms ease-in-out infinite alternate; }
@keyframes zombie-step { from { transform: rotate(-16deg); } to { transform: rotate(16deg); } }
@keyframes zombie-reach { to { transform: translateY(-1px); } }
@media (prefers-reduced-motion: reduce) {
  .zombie-caret { transition: none; }
  .zombie-leg, .zombie-arm { animation: none !important; }
}
</style>
