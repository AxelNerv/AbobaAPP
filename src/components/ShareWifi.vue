<template>
  <div class="settings-page" :class="{ 'settings-page--embedded': embedded }">
    <header class="settings-head">
      <div>
        <h1 class="settings-title">Настройки</h1>
        <p class="settings-lead">Вход, обновления, данные и раздача на телефон.</p>
      </div>
      <div v-if="isApp" class="settings-head-actions">
        <span v-if="updateState.current" class="settings-version">v{{ updateState.current }}</span>
        <button class="btn btn-primary" :disabled="busy || !settingsReady || !dirty" @click="saveSettings">
          {{ dirty ? 'Сохранить' : 'Сохранено' }}
        </button>
      </div>
    </header>

    <div v-if="!isApp" class="card card--muted">
      <AppIcon name="info" :size="20" />
      <p>Настройки работают только в приложении. В браузере эта страница ничего не делает.</p>
    </div>

    <template v-else>
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <p v-if="message" class="notice" role="status">{{ message }}</p>

      <div class="settings-grid">
        <!-- Вход -->
        <section class="card span-2">
          <div class="card-head">
            <span class="dot" :class="loginBadge.tone"></span>
            <h2>Вход через Telegram</h2>
            <span class="badge" :class="loginBadge.tone">{{ loginBadge.text }}</span>
          </div>
          <p class="card-text">
            Сервер хранит и синхронизирует историю, избранное и позиции просмотра между компьютерами.
          </p>
          <p v-if="syncError" class="card-text card-text--error">{{ syncError }}</p>

          <button v-if="!showCustomServer" class="link-btn" @click="showCustomServer = true">
            Свой сервер…
          </button>
          <label v-else class="field">
            <span class="field-label">Свой сервер</span>
            <input
              v-model="authServerUrl"
              class="field-input"
              placeholder="Пусто — сервер по умолчанию"
              :disabled="busy"
              autocomplete="off"
              spellcheck="false"
            />
            <span class="field-hint">Нужен, только если вы подняли собственный сервер входа.</span>
          </label>
        </section>

        <!-- Поведение -->
        <section class="card span-2">
          <div class="card-head"><h2>Поведение</h2></div>
          <div class="toggles">
            <button class="toggle-row" :disabled="busy" @click="closeToTray = !closeToTray">
              <span class="toggle-text">
                <span class="toggle-label">Сворачивать в трей</span>
                <span class="toggle-hint">при закрытии окна</span>
              </span>
              <span class="switch" :class="{ on: closeToTray }"><span class="knob"></span></span>
            </button>
            <button class="toggle-row" :disabled="busy" @click="adblock = !adblock">
              <span class="toggle-text">
                <span class="toggle-label">Блокировать рекламу в плеерах</span>
                <span class="toggle-hint">{{ adblockHint }}</span>
              </span>
              <span class="switch" :class="{ on: adblock }"><span class="knob"></span></span>
            </button>
          </div>
        </section>

        <!-- Обновления -->
        <section v-if="updateState.supported" class="card span-2">
          <div class="card-head">
            <h2>Обновления</h2>
            <span class="badge" :class="updateBadge.tone">{{ updateBadge.text }}</span>
          </div>
          <p class="card-text">{{ updateText }}</p>
          <p v-if="updateState.error" class="card-text card-text--error">{{ updateState.error }}</p>
          <div class="row-actions">
            <button
              class="btn"
              :disabled="updateState.state === 'checking' || updateState.state === 'downloading'"
              @click="checkForUpdates"
            >
              Проверить обновления
            </button>
            <button
              v-if="hasPendingUpdate()"
              class="btn btn-primary"
              :disabled="updateState.state === 'downloading'"
              @click="installUpdate"
            >
              {{ updateActionLabel() }}
            </button>
          </div>
          <p v-if="hasPendingUpdate() && updateState.installable" class="card-hint">
            Приложение закроется на несколько секунд, обновится и откроется снова.
          </p>
          <p v-else-if="hasPendingUpdate()" class="card-hint">
            Эта копия запущена из папки, а не установлена, — скачайте установщик новой версии.
          </p>
        </section>

        <!-- Данные -->
        <section class="card span-6">
          <div class="card-head">
            <h2>Данные и диагностика</h2>
            <span class="status-inline" :class="backendTone">
              <span class="dot" :class="backendTone"></span>{{ backendText }}
            </span>
          </div>
          <p v-if="status.backend?.error" class="card-text card-text--error">{{ status.backend.error }}</p>
          <div class="tiles">
            <button class="tile" :disabled="busy" @click="openLogs">
              <span class="tile-label">Открыть журнал</span>
              <span class="tile-hint">лог приложения</span>
            </button>
            <button class="tile" :disabled="busy" @click="backup">
              <span class="tile-label">Сохранить копию</span>
              <span class="tile-hint">история, избранное, настройки</span>
            </button>
            <button class="tile" :disabled="busy" @click="restore">
              <span class="tile-label">Восстановить копию</span>
              <span class="tile-hint">текущая база сохранится</span>
            </button>
            <button class="tile" :disabled="busy" @click="importFile">
              <span class="tile-label">Импорт библиотеки</span>
              <span class="tile-hint">добавит, ничего не затрёт</span>
            </button>
          </div>
        </section>

        <!-- Раздача -->
        <section class="card span-6">
          <div class="card-head"><h2>Раздача на телефон по Wi-Fi</h2></div>
          <p class="card-text">
            Пока приложение работает, сайт открывается с телефона в той же сети. Войдите там в тот же Telegram-профиль.
          </p>
          <div class="subcards">
            <div class="subcard">
              <div class="subcard-text">
                <div class="subcard-title">{{ status.active ? 'Раздача включена' : 'Раздача выключена' }}</div>
                <div class="subcard-hint">
                  {{ status.active ? 'Адрес и QR-код — ниже' : 'Включите, чтобы открыть доступ' }}
                </div>
              </div>
              <button class="btn btn-primary" :disabled="busy" @click="toggle">
                {{ busy ? '…' : status.active ? 'Выключить' : 'Включить' }}
              </button>
            </div>
            <div class="subcard" :class="{ 'subcard--warn': !status.firewallOpen }">
              <div class="subcard-text">
                <div class="subcard-title">Брандмауэр: {{ status.firewallOpen ? 'порт открыт' : 'порт закрыт' }}</div>
                <div class="subcard-hint">
                  {{ status.firewallOpen ? 'Подключения из локальной сети разрешены' : 'Windows спросит права администратора' }}
                </div>
              </div>
              <button v-if="!status.firewallOpen" class="btn btn-warn" :disabled="busy" @click="openFirewall">
                Открыть
              </button>
            </div>
          </div>

          <div v-if="status.active && status.url" class="share-address">
            <div class="share-qr">
              <qrcode-vue :value="status.url" :size="120" level="M" render-as="svg" />
            </div>
            <div class="share-address-text">
              <span class="field-label">Адрес для телефона</span>
              <div class="share-url">{{ status.url }}</div>
              <button class="btn" @click="copyUrl">
                <AppIcon :name="copied ? 'check' : 'copy'" :size="14" />
                {{ copied ? 'Скопировано' : 'Скопировать' }}
              </button>
              <p class="card-hint">Наведите камеру телефона на код — откроется сразу.</p>
              <p v-for="address in (status.addresses || []).slice(1)" :key="address.address" class="card-hint">
                Другой адаптер ({{ address.name }}): http://{{ address.address }}:{{ status.port }}
              </p>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import QrcodeVue from 'qrcode.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { getSyncStatus, importLibrary } from '@/api/user'
import { useAuthStore } from '@/store/auth'
import { checkForUpdates, hasPendingUpdate, installUpdate, startUpdateWatch, updateActionLabel, updateState } from '@/utils/appUpdates'

// embedded — страница открыта во всплывающем окне, а не отдельным адресом.
defineProps({ embedded: { type: Boolean, default: false } })

const isApp = computed(() => typeof window !== 'undefined' && !!window.electronAPI)
const authStore = useAuthStore()

const status = ref({
  active: false,
  url: null,
  address: null,
  port: null,
  firewallOpen: false,
  backendRunning: null
})
const busy = ref(isApp.value)
const settingsReady = ref(false)
const error = ref('')
const copied = ref(false)
const message = ref('')
const authServerUrl = ref('')
const closeToTray = ref(false)
const adblock = ref(true)
const showCustomServer = ref(false)
const saved = ref({ authServerUrl: '', closeToTray: false, adblock: true })
const sync = ref(null)

const dirty = computed(
  () =>
    authServerUrl.value.trim() !== saved.value.authServerUrl ||
    closeToTray.value !== saved.value.closeToTray ||
    adblock.value !== saved.value.adblock
)

// Если какой-то плеер перестал запускаться — первым делом выключить блокировщик:
// фильтры иногда задевают сам плеер, а не только рекламу.
const adblockHint = computed(() => {
  const info = status.value.adblock
  if (!info?.enabled) return 'выключено — если плеер не запускался, проверьте, помогло ли'
  if (!info.ready) return info.error ? `списки фильтров не загрузились: ${info.error}` : 'загружаем списки фильтров…'
  return `заблокировано запросов: ${info.blocked}`
})

const syncError = computed(() => (sync.value?.enabled && sync.value.error ? `Синхронизация: ${sync.value.error}` : ''))

const loginBadge = computed(() => {
  if (!authStore.token) return { text: 'вход не выполнен', tone: 'muted' }
  if (syncError.value) return { text: 'ошибка синхронизации', tone: 'error' }
  return { text: 'подключено', tone: 'ok' }
})

const updateBadge = computed(() => {
  switch (updateState.state) {
    case 'latest': return { text: 'актуальна', tone: 'ok' }
    case 'available':
    case 'downloaded': return { text: 'есть обновление', tone: 'accent' }
    case 'downloading': return { text: `${updateState.percent}%`, tone: 'accent' }
    case 'checking': return { text: 'проверяем', tone: 'muted' }
    case 'error': return { text: 'ошибка', tone: 'error' }
    default: return { text: 'не проверялось', tone: 'muted' }
  }
})

const updateText = computed(() => {
  const version = `Версия ${updateState.current || '—'}`
  switch (updateState.state) {
    case 'checking': return `${version} — проверяем…`
    case 'latest': return `${version} — установлена последняя.`
    case 'available': return `${version}. Доступна версия ${updateState.version}.`
    case 'downloading': return `Скачиваем версию ${updateState.version}: ${updateState.percent}%`
    case 'downloaded': return `Версия ${updateState.version} скачана.`
    default: return `${version}.`
  }
})

const backendTone = computed(() =>
  status.value.backendRunning === null ? 'muted' : status.value.backendRunning ? 'ok' : 'error'
)
const backendText = computed(() =>
  status.value.backendRunning === null
    ? 'проверяем локальный сервер…'
    : status.value.backendRunning
      ? 'локальный сервер работает'
      : 'локальный сервер недоступен'
)

const refresh = async () => {
  if (!isApp.value) return
  status.value = await window.electronAPI.share.status()
}

const toggle = async () => {
  busy.value = true
  error.value = ''
  try {
    if (status.value.active) {
      await window.electronAPI.share.stop()
    } else {
      const res = await window.electronAPI.share.start()
      if (!res.ok) error.value = res.error || 'Не удалось включить раздачу'
    }
    await refresh()
  } catch (err) {
    error.value = err.message || 'Не удалось изменить раздачу'
  } finally {
    busy.value = false
  }
}

const openFirewall = async () => {
  busy.value = true
  try {
    const result = await window.electronAPI.share.openFirewall()
    if (!result.ok) error.value = 'Порт не открыт: запрос Windows отменён или произошла ошибка.'
    await refresh()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

const copyUrl = async () => {
  try {
    await navigator.clipboard.writeText(status.value.url)
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  } catch {
    error.value = 'Не удалось скопировать'
  }
}

const perform = async (action, success = '') => {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await action()
    if (result?.ok === false && !result.canceled) error.value = result.error || 'Операция не выполнена'
    else if (!result?.canceled) message.value = typeof success === 'function' ? success(result) : success
    await refresh()
    return result
  } catch (err) { error.value = err.message }
  finally { busy.value = false }
}

const saveSettings = async () => {
  const next = { authServerUrl: authServerUrl.value.trim(), closeToTray: closeToTray.value, adblock: adblock.value }
  const result = await perform(() => window.electronAPI.saveSettings(next), 'Настройки сохранены')
  if (result?.ok) saved.value = next
}
const backup = () => perform(() => window.electronAPI.createBackup(), (result) => `Резервная копия сохранена: ${result.file}`)
const restore = () => perform(() => window.electronAPI.restoreBackup(), 'Копия восстановлена')
const importFile = () => perform(async () => {
  const picked = await window.electronAPI.pickImportFile()
  if (!picked?.ok) return picked
  try {
    return { ok: true, ...(await importLibrary(picked.data)) }
  } catch (err) {
    return { ok: false, error: err.status === 401 ? 'Сначала войдите через Telegram' : err.message }
  }
}, (result) => `Импорт готов: история +${result.history}, избранное +${result.favorites}, позиций просмотра ${result.progress}`)
const openLogs = () => perform(async () => { const error = await window.electronAPI.openLogs(); if (error) throw new Error(error) })

startUpdateWatch()

onMounted(async () => {
  try {
    await refresh()
    const current = status.value.settings || {}
    saved.value = {
      authServerUrl: current.authServerUrl || '',
      closeToTray: current.closeToTray || false,
      adblock: current.adblock !== false
    }
    authServerUrl.value = saved.value.authServerUrl
    closeToTray.value = saved.value.closeToTray
    adblock.value = saved.value.adblock
    // Поле своего сервера раскрыто, только если адрес уже задан.
    showCustomServer.value = !!saved.value.authServerUrl
    settingsReady.value = !!status.value.settings
  } catch (err) { error.value = err.message }
  finally { busy.value = false }
  if (authStore.token) getSyncStatus().then((s) => { sync.value = s }).catch(() => {})
})
</script>

<style scoped>
.settings-page {
  max-width: 1180px;
  margin: 0 auto;
  padding: 34px 40px 56px;
  color: #e8eaf0;
}

/* ── Шапка ── */
.settings-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
  margin-bottom: 22px;
  /* Колокольчик и шестерёнка висят в правом углу окна */
  padding-right: 104px;
}
.settings-title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.4px;
  color: #fff;
}
.settings-lead {
  margin: 6px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
}
.settings-head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.settings-version {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
}

/* ── Сетка ── */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 14px;
  align-items: stretch;
}
.span-2 { grid-column: span 2; }
.span-6 { grid-column: span 6; }

.card {
  min-width: 0;
  background: rgba(15, 20, 32, 0.72);
  border: 1px solid rgba(0, 229, 255, 0.1);
  border-radius: 14px;
  padding: 20px 22px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.25);
}
.card--muted {
  display: flex;
  gap: 12px;
  align-items: center;
  color: rgba(255, 255, 255, 0.6);
}
.card-head {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 8px;
}
.card-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
}
.card-head .badge,
.card-head .status-inline {
  margin-left: auto;
}
.card-text {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.5);
}
.card-text--error { color: #ff8aa8; }
.card-hint {
  margin: 10px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.38);
}

/* ── Метки состояния ── */
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.3);
}
.dot.ok { background: var(--accent-color, #00e5ff); box-shadow: 0 0 8px rgba(0, 229, 255, 0.6); }
.dot.error { background: #ff5e8a; }
.badge {
  font-size: 11px;
  border-radius: 999px;
  padding: 3px 9px;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.badge.ok,
.badge.accent {
  color: var(--accent-color, #00e5ff);
  background: rgba(0, 229, 255, 0.08);
  border-color: rgba(0, 229, 255, 0.22);
}
.badge.error {
  color: #ff8aa8;
  background: rgba(255, 82, 82, 0.08);
  border-color: rgba(255, 82, 82, 0.25);
}
.status-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}
.status-inline.ok { color: var(--accent-color, #00e5ff); }
.status-inline.error { color: #ff8aa8; }

/* ── Кнопки ── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 9px;
  padding: 8px 14px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}
.btn:hover:not(:disabled) {
  background: rgba(0, 229, 255, 0.08);
  border-color: rgba(0, 229, 255, 0.3);
}
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-primary {
  color: var(--accent-color, #00e5ff);
  background: rgba(0, 229, 255, 0.1);
  border-color: rgba(0, 229, 255, 0.32);
}
.btn-primary:hover:not(:disabled) {
  background: rgba(0, 229, 255, 0.18);
  border-color: rgba(0, 229, 255, 0.55);
}
.btn-warn {
  color: #1a1204;
  background: #fbbf24;
  border-color: #fbbf24;
}
.btn-warn:hover:not(:disabled) { background: #fcd34d; border-color: #fcd34d; }
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.link-btn {
  font: inherit;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
.link-btn:hover { color: var(--accent-color, #00e5ff); }

/* ── Поле ── */
.field { display: block; }
.field-label {
  display: block;
  font-size: 10px;
  letter-spacing: 0.9px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.38);
  margin-bottom: 6px;
}
.field-input {
  box-sizing: border-box;
  width: 100%;
  background: #090e18;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 9px;
  padding: 10px 12px;
  color: #e8eaf0;
  font: inherit;
  font-size: 13px;
  outline: none;
}
.field-input:focus { border-color: rgba(0, 229, 255, 0.5); }
.field-hint {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

/* ── Переключатели ── */
.toggles { display: flex; flex-direction: column; gap: 2px; }
.toggle-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: calc(100% + 20px);
  margin: 0 -10px;
  padding: 9px 10px;
  border: none;
  border-radius: 9px;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.toggle-row:hover:not(:disabled) { background: rgba(255, 255, 255, 0.035); }
.toggle-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.toggle-label { font-size: 13px; color: #dde3ec; }
.toggle-hint { font-size: 11px; color: rgba(255, 255, 255, 0.38); }
.switch {
  position: relative;
  width: 38px;
  height: 21px;
  flex: 0 0 38px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  transition: background 0.18s;
}
.switch .knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.55);
  transition: left 0.18s, background 0.18s;
}
.switch.on { background: var(--accent-color, #00e5ff); }
.switch.on .knob { left: 20px; background: #04121a; }

/* ── Плитки действий ── */
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  font: inherit;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.075);
  border-radius: 10px;
  padding: 11px 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.tile:hover:not(:disabled) {
  background: rgba(0, 229, 255, 0.06);
  border-color: rgba(0, 229, 255, 0.3);
}
.tile:disabled { opacity: 0.5; cursor: default; }
.tile-label { font-size: 12.5px; font-weight: 600; color: #e8eaf0; }
.tile-hint { font-size: 10.5px; color: rgba(255, 255, 255, 0.38); line-height: 1.4; }

/* ── Раздача ── */
.subcards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}
.subcard {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.028);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 11px;
  padding: 13px 14px;
}
.subcard--warn {
  background: rgba(245, 158, 11, 0.05);
  border-color: rgba(245, 158, 11, 0.25);
}
.subcard--warn .subcard-title { color: #fbbf24; }
.subcard-text { flex: 1; min-width: 0; }
.subcard-title { font-size: 13px; font-weight: 600; color: #fff; }
.subcard-hint { font-size: 11px; color: rgba(255, 255, 255, 0.4); margin-top: 2px; }

.share-address {
  display: flex;
  gap: 18px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 14px;
  padding: 14px;
  border-radius: 11px;
  border: 1px solid rgba(0, 229, 255, 0.18);
  background: rgba(0, 229, 255, 0.04);
}
.share-qr {
  padding: 8px;
  background: #fff;
  border-radius: 10px;
  line-height: 0;
}
.share-address-text { flex: 1; min-width: 200px; }
.share-url {
  margin: 2px 0 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--accent-color, #00e5ff);
  word-break: break-all;
}

/* ── Сообщения ── */
.notice {
  margin: 0 0 14px;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(0, 229, 255, 0.06);
  border: 1px solid rgba(0, 229, 255, 0.18);
}
.notice--error {
  color: #ff8aa8;
  background: rgba(255, 82, 82, 0.08);
  border-color: rgba(255, 82, 82, 0.28);
}

/* Во всплывающем окне отступы даёт само окно, а значки в углу оно перекрывает */
.settings-page--embedded { padding: 0; max-width: none; }
.settings-page--embedded .settings-head { padding-right: 48px; }

@media (max-width: 900px) {
  .settings-page { padding: 24px 16px 48px; }
  .span-2, .span-6 { grid-column: span 6; }
  .settings-head { padding-right: 0; }
}
</style>
