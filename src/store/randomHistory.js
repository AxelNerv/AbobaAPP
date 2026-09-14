import { defineStore } from 'pinia'

// Используем window как хранилище чтобы данные жили между роутами
const getWindowState = () => {
  if (typeof window === 'undefined') return { history: [], currentIndex: -1 }
  if (!window.__randomHistory) {
    window.__randomHistory = { history: [], currentIndex: -1 }
  }
  return window.__randomHistory
}

export const useRandomHistoryStore = defineStore('randomHistory', {
  state: () => ({
    history: getWindowState().history,
    currentIndex: getWindowState().currentIndex
  }),
  getters: {
    currentMovie: (state) => state.history[state.currentIndex] || null,
    hasPrev: (state) => state.currentIndex > 0,
    hasNext: (state) => state.currentIndex < state.history.length - 1,
    isActive: (state) => state.history.length > 0 && state.currentIndex >= 0
  },
  actions: {
    _sync() {
      if (typeof window !== 'undefined') {
        window.__randomHistory = {
          history: this.history,
          currentIndex: this.currentIndex
        }
      }
    },
    _load() {
      const s = getWindowState()
      this.history = s.history
      this.currentIndex = s.currentIndex
    },
    addMovie(movie) {
      this._load()
      if (this.currentIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.currentIndex + 1)
      }
      this.history.push(movie)
      this.currentIndex = this.history.length - 1
      this._sync()
    },
    goToPrev() {
      this._load()
      if (this.hasPrev) {
        this.currentIndex--
        this._sync()
      }
    },
    goToNext() {
      this._load()
      if (this.hasNext) {
        this.currentIndex++
        this._sync()
      }
    },
    clear() {
      this.history = []
      this.currentIndex = -1
      this._sync()
    }
  }
})
