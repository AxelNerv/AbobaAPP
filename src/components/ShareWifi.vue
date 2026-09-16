<template>
  <div class="share-page">
    <h1 class="share-title">Приложение и Wi-Fi</h1>
    <p class="share-lead">
      Пока приложение работает, сайт можно открыть с телефона в той же сети.
      Для доступа к своей истории войдите на телефоне в тот же Telegram-профиль.
    </p>

    <div v-if="!isApp" class="share-card share-card--muted">
      <AppIcon name="info" :size="20" />
      <p>Раздача работает только в приложении. В браузере эта страница ничего не делает.</p>
    </div>

    <template v-else>
      <div class="share-card">
        <div class="share-row-title">Вход через Telegram</div>
        <p class="share-hint">Сервер входа хранит и синхронизирует историю. Поле можно оставить пустым — будет сервер по умолчанию.</p>
        <label class="share-label" for="auth-server">Адрес сервера</label>
        <input id="auth-server" v-model="authServerUrl" class="settings-input" :placeholder="status.defaultAuthServerUrl || 'https://auth.example.com'" :disabled="busy" />
        <label class="tray-option"><input v-model="closeToTray" type="checkbox" :disabled="busy" /> Сворачивать в трей при закрытии окна</label>
        <label class="tray-option"><input v-model="adblock" type="checkbox" :disabled="busy" /> Блокировать рекламу в плеерах</label>
        <p v-if="status.adblock" class="share-hint">{{ adblockHint }}</p>
        <button class="share-toggle" :disabled="busy || !settingsReady" @click="saveSettings">Сохранить настройки</button>
        <p v-if="status.authServerUrl" class="share-hint">Используется: {{ status.authServerUrl }}</p>
      </div>
      <div v-if="updateState.supported" class="share-card">
        <div class="share-row-title">Обновления</div>
        <p class="share-hint">Версия {{ updateState.current }}. {{ updateText }}</p>
        <p v-if="updateState.error" class="share-error">{{ updateState.error }}</p>
        <div class="settings-actions">
          <button class="share-copy" :disabled="updateState.state === 'checking' || updateState.state === 'downloading'" @click="checkForUpdates">Проверить обновления</button>
          <button v-if="hasPendingUpdate()" class="share-toggle" :disabled="updateState.state === 'downloading'" @click="installUpdate">{{ updateActionLabel() }}</button>
        </div>
        <p v-if="hasPendingUpdate() && updateState.installable" class="share-hint">Приложение закроется на несколько секунд, обновится и откроется снова. История и настройки сохранятся.</p>
        <p v-else-if="hasPendingUpdate()" class="share-hint">Эта копия запущена из папки, а не установлена, поэтому обновить её на месте нельзя — скачай установщик новой версии.</p>
      </div>
      <div class="share-card">
        <div class="share-row-title">Данные и диагностика</div>
        <p class="share-hint">{{ status.backendRunning === null ? 'Проверяем локальный сервер…' : status.backendRunning ? 'Локальный сервер работает' : 'Локальный сервер недоступен' }}</p>
        <p v-if="status.backend?.error" class="share-error">{{ status.backend.error }}</p>
        <div class="settings-actions">
          <button class="share-copy" :disabled="busy" @click="openLogs">Открыть журнал</button>
          <button class="share-copy" :disabled="busy" @click="backup">Сохранить копию</button>
          <button class="share-copy" :disabled="busy" @click="restore">Восстановить копию</button>
          <button class="share-copy" :disabled="busy" @click="importFile">Импорт библиотеки</button>
        </div>
        <p class="share-hint">Копия содержит историю, избранное и настройки этого приложения. Перед восстановлением сохраняется текущая база.</p>
        <p class="share-hint">Импорт добавляет историю, избранное и позиции просмотра из файла (например, из браузера) и ничего не затирает. Нужен вход.</p>
      </div>
      <p v-if="error" class="share-error" role="alert">{{ error }}</p>
      <p v-if="message" class="share-hint" role="status">{{ message }}</p>
      <div class="share-card">
        <div class="share-row">
          <div>
            <div class="share-row-title">
              {{ status.active ? 'Раздача включена' : 'Раздача выключена' }}
            </div>
            <div class="share-row-sub">
              {{ status.active ? 'Адрес ниже открывается с телефона' : 'Включите, чтобы открыть доступ' }}
            </div>
          </div>
          <button
            class="share-toggle"
            :class="{ active: status.active }"
            :disabled="busy"
            @click="toggle"
          >
            {{ busy ? '...' : status.active ? 'Выключить' : 'Включить' }}
          </button>
        </div>

      </div>

      <div v-if="status.active && status.url" class="share-card share-card--address">
        <div class="share-qr">
          <qrcode-vue :value="status.url" :size="128" level="M" render-as="svg" />
        </div>

        <div class="share-address-block">
          <div class="share-label">Адрес для телефона</div>
          <div class="share-url">{{ status.url }}</div>
          <button class="share-copy" @click="copyUrl">
            <AppIcon :name="copied ? 'check' : 'copy'" :size="15" />
            {{ copied ? 'Скопировано' : 'Скопировать' }}
          </button>
          <p class="share-hint">Наведите камеру телефона на код — откроется сразу</p>
          <p v-for="address in (status.addresses || []).slice(1)" :key="address.address" class="share-hint">Другой адаптер ({{ address.name }}): http://{{ address.address }}:{{ status.port }}</p>
        </div>
      </div>

      <div class="share-card" :class="{ 'share-card--warn': !status.firewallOpen }">
        <div class="share-row">
          <div>
            <div class="share-row-title">
              Брандмауэр: {{ status.firewallOpen ? 'порт открыт' : 'порт закрыт' }}
            </div>
            <div class="share-row-sub">
              {{
                status.firewallOpen
                  ? 'Windows пропускает подключения из локальной сети'
                  : 'Без этого телефон не достучится до компьютера'
              }}
            </div>
          </div>
          <button
            v-if="!status.firewallOpen"
            class="share-toggle"
            :disabled="busy"
            @click="openFirewall"
          >
            Открыть
          </button>
        </div>
        <p class="share-hint">
          Правило действует для частной сети Windows и устройств в локальной подсети.
          Windows спросит права администратора.
        </p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import QrcodeVue from 'qrcode.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { importLibrary } from '@/api/user'
import { checkForUpdates, hasPendingUpdate, installUpdate, startUpdateWatch, updateActionLabel, updateState } from '@/utils/appUpdates'

const isApp = computed(() => typeof window !== 'undefined' && !!window.electronAPI)

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
// Если какой-то плеер перестал запускаться — первым делом выключить блокировщик:
// фильтры иногда задевают сам плеер, а не только рекламу.
const adblockHint = computed(() => {
  const info = status.value.adblock
  if (!info?.enabled) return 'Блокировщик выключен. Если плеер не запускался — проверьте, помогло ли.'
  if (!info.ready) return info.error ? `Списки фильтров не загрузились: ${info.error}` : 'Загружаем списки фильтров…'
  return `Заблокировано запросов: ${info.blocked}. Если плеер не запускается — попробуйте выключить.`
})

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
  } catch (err) { error.value = err.message }
  finally { busy.value = false }
}
const saveSettings = () => perform(() => window.electronAPI.saveSettings({ authServerUrl: authServerUrl.value, closeToTray: closeToTray.value, adblock: adblock.value }), 'Настройки сохранены')
const backup = () => perform(() => window.electronAPI.createBackup(), (result) => `Резервная копия сохранена: ${result.file}`)
const updateText = computed(() => {
  switch (updateState.state) {
    case 'checking': return 'Проверяем…'
    case 'latest': return 'Установлена последняя версия.'
    case 'available': return `Доступна версия ${updateState.version}.`
    case 'downloading': return `Скачиваем версию ${updateState.version}: ${updateState.percent}%`
    case 'downloaded': return `Версия ${updateState.version} скачана.`
    default: return ''
  }
})
startUpdateWatch()
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
onMounted(async () => {
  try {
    await refresh()
    authServerUrl.value = status.value.settings?.authServerUrl || ''
    closeToTray.value = status.value.settings?.closeToTray || false
    adblock.value = status.value.settings?.adblock !== false
    settingsReady.value = !!status.value.settings
  } catch (err) { error.value = err.message }
  finally { busy.value = false }
})
</script>

<style scoped>
.settings-input { display: block; box-sizing: border-box; width: 100%; margin: 10px 0 16px; padding: 12px; border-radius: 8px; border: 1px solid #375563; background: #090e18; color: #fff; }
.tray-option { display: flex; gap: 10px; margin: 16px 0; font-size: 14px; }
.settings-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.share-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 24px 60px;
}

.share-title {
  margin: 0 0 8px;
  font-size: 26px;
  font-weight: 700;
  color: #fff;
}

.share-lead {
  margin: 0 0 24px;
  font-size: 14px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.5);
}

.share-card {
  background: #0f1420;
  border: 1px solid rgba(0, 229, 255, 0.16);
  border-radius: 14px;
  padding: 20px 22px;
  margin-bottom: 16px;
}

.share-card--muted {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 14px;
}

.share-card--muted p {
  margin: 0;
}

.share-card--warn {
  border-color: rgba(255, 180, 90, 0.35);
}

.share-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.share-row-title {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
}

.share-row-sub {
  margin-top: 4px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
}

.share-toggle {
  flex-shrink: 0;
  padding: 10px 20px;
  border-radius: 10px;
  border: 1px solid rgba(0, 229, 255, 0.35);
  background: rgba(0, 229, 255, 0.1);
  color: var(--accent-color, #00e5ff);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.18s ease;
}

.share-toggle:hover:not(:disabled) {
  background: rgba(0, 229, 255, 0.18);
}

.share-toggle.active {
  border-color: rgba(255, 120, 130, 0.4);
  background: rgba(255, 120, 130, 0.12);
  color: #ff8a94;
}

.share-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.share-card--address {
  display: flex;
  gap: 24px;
  align-items: center;
}

.share-qr {
  flex-shrink: 0;
  width: 148px;
  height: 148px;
  padding: 10px;
  background: #fff;
  border-radius: 12px;
}

.share-qr :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.share-address-block {
  min-width: 0;
}

.share-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.35);
}

.share-url {
  margin: 6px 0 12px;
  font-size: 19px;
  font-weight: 600;
  color: var(--accent-color, #00e5ff);
  word-break: break-all;
}

.share-copy {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 14px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
  cursor: pointer;
}

.share-copy:hover {
  background: rgba(255, 255, 255, 0.09);
}

.share-hint {
  margin: 12px 0 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.38);
}

.share-error {
  margin: 14px 0 0;
  font-size: 13px;
  color: #ff8a94;
}

@media (max-width: 640px) {
  .share-card--address {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
