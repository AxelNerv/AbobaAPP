/**
 * Состояние обновлений приложения — одно на всё окно.
 *
 * Главный процесс сам проверяет выпуски GitHub и присылает состояние;
 * колокольчик и настройки только показывают его и жмут кнопки.
 * На сайте (без Electron) всё это молча отключено.
 */
import { reactive } from 'vue'

const api = () => (typeof window !== 'undefined' ? window.electronAPI?.updates : null)

export const updateState = reactive({
  supported: false,
  state: 'idle',
  current: '',
  version: null,
  notes: '',
  percent: 0,
  error: '',
  installable: false,
  releasesUrl: ''
})

const listeners = new Set()
let started = false

const apply = (next) => {
  if (!next) return
  Object.assign(updateState, next, { supported: true })
  listeners.forEach((listener) => listener(updateState))
}

export const startUpdateWatch = () => {
  if (started || !api()) return
  started = true
  api().onStatus(apply)
  api().status().then(apply).catch((error) => {
    apply({ state: 'error', error: `Не удалось получить состояние обновлений: ${error?.message || error}` })
  })
}

export const onUpdateState = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const checkForUpdates = async () => {
  if (!api()) return
  try {
    apply(await api().check())
  } catch (error) {
    apply({ state: 'error', error: `Проверка обновлений не удалась: ${error?.message || error}` })
  }
}

/** Установленная версия ставит поверх; распакованная папка ведёт на страницу выпуска. */
export const installUpdate = async () => {
  if (!api()) return { ok: false }
  if (!updateState.installable) {
    window.electronAPI.openExternal(updateState.releasesUrl)
    return { ok: true, external: true }
  }
  const result = await api().install()
  if (!result?.ok && result?.error) updateState.error = result.error
  return result
}

export const updateActionLabel = (state = updateState) => {
  if (!state.installable) return 'Скачать с GitHub'
  if (state.state === 'downloading') return `Скачивается… ${state.percent}%`
  if (state.state === 'downloaded') return 'Перезапустить и установить'
  return 'Установить обновление'
}

export const hasPendingUpdate = (state = updateState) =>
  !!state.version && ['available', 'downloading', 'downloaded', 'error'].includes(state.state)
