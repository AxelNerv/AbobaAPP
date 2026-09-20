<template>
  <div class="library">
    <header class="lib-head">
      <div class="lib-user">
        <div class="lib-avatar">
          <img v-if="avatar" :src="avatar" :alt="userName" @error="avatarBroken = true" />
          <span v-else>{{ initial }}</span>
        </div>
        <div>
          <div class="lib-kicker">Моя библиотека</div>
          <h1 class="lib-name">{{ userName }}</h1>
        </div>
      </div>

      <div class="lib-head-right">
        <div class="lib-search">
          <AppIcon name="search" :size="16" class="lib-search-icon" />
          <input
            v-model="query"
            type="search"
            class="lib-search-input"
            placeholder="Поиск по библиотеке"
          />
        </div>

        <button v-if="authStore.user" class="lib-logout" @click="logout">Выйти</button>
      </div>
    </header>

    <nav class="lib-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="lib-tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
        <span class="lib-tab-count">{{ tab.count }}</span>
      </button>
    </nav>

    <div class="lib-controls">
      <div class="lib-chips">
        <button
          v-for="chip in typeChips"
          :key="chip.id"
          class="lib-chip"
          :class="{ active: activeType === chip.id }"
          @click="activeType = chip.id"
        >
          {{ chip.label }}
        </button>
      </div>

      <div class="lib-actions">
        <span class="lib-total">{{ totalLabel }}</span>
        <button
          v-if="visibleItems.length"
          class="lib-clear"
          :disabled="clearing"
          @click="askClear"
        >
          {{ activeTab === 'history' ? 'Очистить историю' : 'Очистить избранное' }}
        </button>
      </div>
    </div>

    <div v-if="syncError" class="lib-sync-error">{{ syncError }}</div>

    <div v-if="loading" class="lib-state">Загружаем…</div>

    <div v-else-if="loadError" class="lib-state lib-state-error">
      Не удалось загрузить библиотеку: {{ loadError }}
      <button class="lib-retry" @click="load">Повторить</button>
    </div>

    <div v-else-if="!visibleItems.length" class="lib-state">
      {{ query ? 'Ничего не нашлось по запросу' : 'Здесь пока пусто' }}
    </div>

    <template v-else>
      <section v-for="group in groups" :key="group.title" class="lib-group">
        <div class="lib-group-head">
          <h2 class="lib-group-title">{{ group.title }}</h2>
          <span class="lib-group-count">{{ group.items.length }} шт</span>
        </div>

        <div class="lib-grid">
          <article v-for="item in group.items" :key="item.kp_id" class="lib-card">
            <router-link :to="pathFor(item)" class="lib-poster-link">
              <div class="lib-poster">
                <img
                  :src="posterFor(item)"
                  :alt="item.title"
                  loading="lazy"
                  @error="onPosterError($event, item)"
                />
                <span class="lib-badge">{{ typeLabel(item) }}</span>
              </div>
            </router-link>

            <div class="lib-card-actions">
              <button class="lib-remove" title="Убрать" @click.stop="removeItem(item)">
                <AppIcon name="close" :size="13" />
              </button>
            </div>

            <router-link :to="pathFor(item)" class="lib-caption">
              <div class="lib-card-title">{{ item.title }}</div>
              <div class="lib-card-sub">{{ subtitleFor(item) }}</div>
            </router-link>
          </article>
        </div>
      </section>
    </template>

    <BaseModal
      :is-open="confirmOpen"
      :message="
        activeTab === 'history'
          ? 'Очистить всю историю просмотра?'
          : 'Очистить всё избранное?'
      "
      @confirm="doClear"
      @close="confirmOpen = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import BaseModal from '@/components/BaseModal.vue'
import { getMyLists, delFromList, delAllFromList, getSyncStatus } from '@/api/user'
import { useAuthStore } from '@/store/auth'
import { useMainStore } from '@/store/main'
import { USER_LIST_TYPES_ENUM } from '@/constants'
import { getMovieSeoPath } from '@/utils/movieSeo'
import { deviceImage, resolvePosterByMovie, resolvePosterChain } from '@/utils/mediaUtils'

const authStore = useAuthStore()
const mainStore = useMainStore()

const history = ref([])
const favorites = ref([])
const loading = ref(true)
const loadError = ref('')
const syncError = ref('')
const clearing = ref(false)
const confirmOpen = ref(false)
const avatarBroken = ref(false)

const query = ref('')
const activeTab = ref('history')
const activeType = ref('all')

const userName = computed(() => authStore.user?.name || 'Профиль')
const initial = computed(() => userName.value.trim().charAt(0).toUpperCase() || '?')
const avatar = computed(() => (avatarBroken.value ? '' : authStore.user?.photo || ''))

const tabs = computed(() => [
  { id: 'history', label: 'История просмотра', count: history.value.length },
  { id: 'favorites', label: 'Избранное', count: favorites.value.length }
])

// «Аниме» отдельным типом не хранится — источник отдаёт только сериал/фильм,
// поэтому такой чип был бы всегда пустым.
const typeChips = [
  { id: 'all', label: 'Все' },
  { id: 'serial', label: 'Сериал' },
  { id: 'film', label: 'Фильм' }
]

const rawItems = computed(() => (activeTab.value === 'history' ? history.value : favorites.value))

const normalizeType = (item) => {
  const raw = String(item?.type || item?.raw_data?.type || '').toLowerCase()
  if (raw.includes('serial') || raw.includes('series')) return 'serial'
  if (raw.includes('film') || raw.includes('movie')) return 'film'
  return 'other'
}

const typeLabel = (item) => (normalizeType(item) === 'serial' ? 'Сериал' : 'Фильм')

const visibleItems = computed(() => {
  const q = query.value.trim().toLowerCase()
  return rawItems.value.filter((item) => {
    if (activeType.value !== 'all' && normalizeType(item) !== activeType.value) return false
    if (!q) return true
    return String(item.title || '').toLowerCase().includes(q)
  })
})

const totalLabel = computed(() => {
  const n = visibleItems.value.length
  const word = activeTab.value === 'history' ? 'в истории' : 'в избранном'
  return `${n} ${word}`
})

/** Группируем по дате добавления — так список читается как лента. */
const groups = computed(() => {
  if (activeTab.value !== 'history') {
    return [{ title: 'Избранное', items: visibleItems.value }]
  }

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86400000

  const buckets = [
    { title: 'Сегодня', from: startOfToday, items: [] },
    { title: 'Вчера', from: startOfToday - day, items: [] },
    { title: 'На этой неделе', from: startOfToday - day * 7, items: [] },
    { title: 'Ранее', from: -Infinity, items: [] }
  ]

  for (const item of visibleItems.value) {
    const ts = Date.parse(item.addedAt || item.added_at || '') || 0
    const bucket = buckets.find((b) => ts >= b.from) || buckets[buckets.length - 1]
    bucket.items.push(item)
  }

  return buckets.filter((b) => b.items.length)
})

const pathFor = (item) => getMovieSeoPath(item)
const posterFor = (item) => deviceImage(resolvePosterByMovie(item))

const subtitleFor = (item) => {
  const parts = []
  if (item.year) parts.push(item.year)
  const rating = item.rating_kp || item.average_rating
  if (rating) parts.push(`КП ${rating}`)
  return parts.join(' · ')
}

/** Тот же приём, что и в карточках: висящий хост подменяем следующим. */
const onPosterError = (event, item) => {
  const img = event.target
  if (!img) return
  const chain = resolvePosterChain(item).map(deviceImage)
  const current = img.currentSrc || img.src || ''
  const next = chain[chain.findIndex((u) => u === current) + 1]
  if (next) img.src = next
  else img.onerror = null
}

const listTypeFor = () =>
  activeTab.value === 'history' ? USER_LIST_TYPES_ENUM.HISTORY : USER_LIST_TYPES_ENUM.FAVORITE

const load = async () => {
  if (!authStore.token) {
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = ''
  try {
    // Ошибку не глотаем: пустой список и «бэкенд не ответил» — разные вещи.
    const [h, f] = await Promise.all([
      getMyLists(USER_LIST_TYPES_ENUM.HISTORY),
      getMyLists(USER_LIST_TYPES_ENUM.FAVORITE)
    ])
    history.value = Array.isArray(h) ? h : []
    favorites.value = Array.isArray(f) ? f : []
    mainStore.setHistory(history.value)
  } catch (err) {
    loadError.value = err?.status === 401 ? 'вход устарел, войдите заново' : err?.message || 'ошибка сети'
  } finally {
    loading.value = false
  }
  getSyncStatus()
    .then((state) => {
      syncError.value = state?.enabled && state.error ? `Синхронизация не работает: ${state.error}` : ''
    })
    .catch((error) => {
      syncError.value = `Не удалось проверить синхронизацию: ${error?.message || 'ошибка сети'}`
    })
}

const removeItem = async (item) => {
  const type = listTypeFor()
  const list = activeTab.value === 'history' ? history : favorites
  const before = list.value
  list.value = before.filter((x) => String(x.kp_id) !== String(item.kp_id))
  try {
    await delFromList(item.kp_id, type)
  } catch (error) {
    list.value = before // не удалилось на сервере — возвращаем как было
    loadError.value = `Не удалось удалить: ${error?.message || 'ошибка сервера'}`
  }
}

const logout = () => {
  authStore.logout?.()
  window.location.href = '/login'
}

const askClear = () => {
  confirmOpen.value = true
}

const doClear = async () => {
  const targetTab = activeTab.value
  const targetType =
    targetTab === 'history' ? USER_LIST_TYPES_ENUM.HISTORY : USER_LIST_TYPES_ENUM.FAVORITE
  confirmOpen.value = false
  clearing.value = true
  try {
    await delAllFromList(targetType)
    if (targetTab === 'history') history.value = []
    else favorites.value = []
  } catch (error) {
    loadError.value = `Не удалось очистить список: ${error?.message || 'ошибка сервера'}`
  } finally {
    clearing.value = false
  }
}

watch(activeTab, () => {
  query.value = ''
  activeType.value = 'all'
})

onMounted(load)
</script>

<style scoped>
.library {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 28px 64px;
}

/* ── Шапка ── */
.lib-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}

.lib-user {
  display: flex;
  align-items: center;
  gap: 16px;
}

.lib-avatar {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #3a2a6a, #1c2a5c);
  color: #fff;
  font-size: 21px;
  font-weight: 700;
}

.lib-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lib-kicker {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
}

.lib-name {
  margin: 4px 0 0;
  font-size: 28px;
  font-weight: 700;
  color: #fff;
}

.lib-head-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  justify-content: flex-end;
  /* Колокольчик уведомлений прибит к правому верхнему углу окна (20–60px от
     края), а библиотека центрируется. В окне уже ~1550px её правый край
     заезжал под колокольчик, и он накрывал кнопку «Выйти».
     Геометрия (замерено): контент страниц начинается с 120px, библиотека
     с полями — до 1336px и центрируется в остатке, поэтому справа от неё
     остаётся (100vw − 120 − 1336) / 2, плюс 28px её поля. Кнопке нужно ~76px
     от края; 10px сверху — запас на полосу прокрутки Windows. */
  /* 58px — колокольчик, ещё 48px — шестерёнка настроек слева от него */
  margin-right: max(0px, calc(106px - max(0px, (100vw - 1456px) / 2)));
}

.lib-logout {
  flex-shrink: 0;
  padding: 11px 20px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.7);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.lib-logout:hover {
  border-color: rgba(255, 120, 130, 0.45);
  color: #ff8a94;
}

.lib-search {
  position: relative;
  min-width: 280px;
  flex: 1;
  max-width: 380px;
}

.lib-search-icon {
  position: absolute;
  left: 13px;
  top: 50%;
  transform: translateY(-50%);
  color: rgba(255, 255, 255, 0.35);
  pointer-events: none;
}

.lib-search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 11px 14px 11px 38px;
  font-family: inherit;
  font-size: 14px;
  color: #fff;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  outline: none;
  transition: border-color 0.18s ease, background 0.18s ease;
}

.lib-search-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.lib-search-input:focus {
  border-color: rgba(var(--accent-rgb), 0.45);
  background: rgba(255, 255, 255, 0.06);
}

/* ── Вкладки ── */
.lib-tabs {
  display: flex;
  gap: 26px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 20px;
}

.lib-tab {
  position: relative;
  padding: 0 0 13px;
  background: none;
  border: none;
  font-family: inherit;
  font-size: 15.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.42);
  cursor: pointer;
  transition: color 0.18s ease;
}

.lib-tab:hover {
  color: rgba(255, 255, 255, 0.7);
}

.lib-tab.active {
  color: #fff;
}

.lib-tab.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--accent-color, #00e5ff);
}

.lib-tab-count {
  margin-left: 7px;
  font-size: 12.5px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.35);
}

/* ── Фильтры ── */
.lib-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 26px;
}

.lib-chips {
  display: flex;
  gap: 8px;
}

.lib-chip {
  padding: 8px 17px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.62);
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s ease;
}

.lib-chip:hover {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.2);
}

.lib-chip.active {
  border-color: rgba(var(--accent-rgb), 0.5);
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent-color, #00e5ff);
}

.lib-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.lib-total {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
}

.lib-clear {
  padding: 8px 15px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.lib-clear:hover:not(:disabled) {
  border-color: rgba(255, 120, 130, 0.45);
  color: #ff8a94;
}

/* ── Группы и карточки ── */
.lib-group {
  margin-bottom: 34px;
}

.lib-group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 14px;
}

.lib-group-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
}

.lib-group-count {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.28);
}

.lib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  gap: 18px;
}

.lib-card {
  position: relative;
  /* Единый блок: постер и подпись в одной рамке. Раньше название висело
     на фоне страницы и выглядело оторванным от обложки. */
  border-radius: 14px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.07);
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease,
    box-shadow 0.2s ease;
}

.lib-card:hover {
  transform: translateY(-3px);
  background: rgba(var(--accent-rgb), 0.06);
  border-color: rgba(var(--accent-rgb), 0.4);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.5), 0 0 18px rgba(var(--accent-rgb), 0.1);
}

.lib-poster-link {
  display: block;
  text-decoration: none;
}

.lib-poster {
  position: relative;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
}



.lib-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.lib-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 3px 9px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.72);
  color: rgba(255, 255, 255, 0.85);
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.lib-card-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 5px;
}

.lib-remove {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  border: none;
  background: rgba(0, 0, 0, 0.72);
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.lib-card:hover .lib-remove {
  opacity: 1;
}




.lib-remove:hover {
  background: rgba(255, 90, 100, 0.85);
  color: #fff;
}

.lib-caption {
  display: block;
  padding: 10px 12px 12px;
  text-decoration: none;
}

.lib-card-title {
  font-size: 13.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.lib-card-sub {
  margin-top: 3px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.38);
}

.lib-state {
  padding: 60px 0;
  text-align: center;
  font-size: 14.5px;
  color: rgba(255, 255, 255, 0.35);
}

.lib-state-error {
  color: #ff8aa8;
}

.lib-retry {
  display: block;
  margin: 14px auto 0;
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  cursor: pointer;
}

.lib-sync-error {
  margin: -12px 0 18px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 82, 82, 0.28);
  background: rgba(255, 82, 82, 0.08);
  color: #ff8aa8;
  font-size: 13px;
}

@media (max-width: 640px) {
  .library {
    padding: 24px 16px 48px;
  }

  /* На телефоне колокольчика нет — отступ под него не нужен. */
  .lib-head-right {
    margin-right: 0;
    width: 100%;
  }

  /* Поле забирает остаток строки рядом с «Выйти». С min-width: 100% оно
     вместе с кнопкой не помещалось и уезжало за левый край экрана. */
  .lib-search {
    min-width: 0;
    max-width: none;
  }

  .lib-grid {
    grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
    gap: 14px;
  }

  .lib-remove {
    opacity: 1;
  }
}
</style>
