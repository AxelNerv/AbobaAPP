import { defineStore } from 'pinia'

/**
 * Оформление: цвет акцента (обводка кнопок, постеров, подсветка фокуса)
 * и фон страницы. Весь интерфейс берёт цвет из --accent-color и
 * --accent-rgb, поэтому достаточно переписать эти переменные.
 */
export const ACCENT_PRESETS = [
  { id: 'cyan', name: 'Бирюзовый', value: '#00e5ff', hover: '#00b0ff', light: '#6ff9ff', dark: '#0091ea' },
  { id: 'violet', name: 'Фиолетовый', value: '#b388ff', hover: '#9d6bff', light: '#d1b8ff', dark: '#7c4dff' },
  { id: 'green', name: 'Зелёный', value: '#00e676', hover: '#00c853', light: '#69f0ae', dark: '#00a152' },
  { id: 'amber', name: 'Янтарный', value: '#ffb300', hover: '#ff8f00', light: '#ffd54f', dark: '#ff6f00' }
]

export const BACKGROUNDS = [
  { id: 'glow', name: 'Сияние' },
  { id: 'accent', name: 'В цвет акцента' },
  { id: 'poster', name: 'Постер фильма' },
  { id: 'plain', name: 'Тёмный' }
]

const DEFAULT_CUSTOM = '#ff4081'

const createNoopStorage = () => ({
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
})

export const hexToRgb = (hex) => {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''))
  return match ? match.slice(1).map((part) => parseInt(part, 16)) : null
}

const toHex = (rgb) =>
  `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`

// Светлее/темнее — смешиванием с белым/чёрным, чтобы не уходить в другой оттенок.
const mix = (rgb, target, amount) => rgb.map((c) => c + (target - c) * amount)

/** Палитра для произвольного цвета в том же виде, что и у готовых. */
export const paletteFor = (hex) => {
  const rgb = hexToRgb(hex)
  if (!rgb) return ACCENT_PRESETS[0]
  return {
    id: 'custom',
    name: 'Свой',
    value: toHex(rgb),
    hover: toHex(mix(rgb, 0, 0.18)),
    light: toHex(mix(rgb, 255, 0.4)),
    dark: toHex(mix(rgb, 0, 0.35))
  }
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    accent: 'cyan',
    customColor: DEFAULT_CUSTOM,
    background: 'glow'
  }),

  getters: {
    palette: (state) =>
      state.accent === 'custom'
        ? paletteFor(state.customColor)
        : ACCENT_PRESETS.find((preset) => preset.id === state.accent) || ACCENT_PRESETS[0]
  },

  actions: {
    setAccent(id) {
      this.accent = id === 'custom' || ACCENT_PRESETS.some((preset) => preset.id === id) ? id : 'cyan'
      this.apply()
    },

    setCustomColor(hex) {
      if (!hexToRgb(hex)) return
      this.customColor = hex.toLowerCase()
      this.accent = 'custom'
      this.apply()
    },

    setBackground(id) {
      this.background = BACKGROUNDS.some((item) => item.id === id) ? id : 'glow'
      this.apply()
    },

    apply() {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      const palette = this.palette
      root.style.setProperty('--accent-rgb', hexToRgb(palette.value).join(', '))
      root.style.setProperty('--accent-color', palette.value)
      root.style.setProperty('--accent-hover', palette.hover)
      root.style.setProperty('--accent-light', palette.light)
      root.style.setProperty('--accent-dark', palette.dark)
      root.dataset.bg = this.background
    },

    initTheme() {
      this.apply()
    }
  },

  persist: {
    key: 'aboba-theme',
    storage: typeof window !== 'undefined' ? window.localStorage : createNoopStorage(),
    paths: ['accent', 'customColor', 'background']
  }
})
