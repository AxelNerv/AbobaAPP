<template>
  <ErrorMessage v-if="errorMessage" :message="errorMessage" :code="errorCode" />

  <template v-else>
    <!-- Кнопка для открытия модалки выбора плеера -->
    <div class="players-list">
      <span>Плеер:</span>
      <button class="player-btn" @click="openPlayerModal">
        {{
          selectedPlayerInternal
            ? getProviderDisplayName(selectedPlayerInternal).toUpperCase()
            : 'Загрузка плееров...'
        }}
        <span v-if="selectedPlayerInternal?.uhd" class="uhd-badge">4K</span>
      </button>
      <button v-if="isKinoBdProvider" class="source-btn" @click="openSourceModal">Источник</button>
    </div>

    <!-- Модальное окно выбора плеера -->
    <PlayerModal
      v-if="showPlayerModal"
      :players="playersInternal"
      :selected-player="selectedPlayerInternal"
      @close="closePlayerModal"
      @select="handlePlayerSelect"
    />

    <div v-if="showSourceModal" class="source-modal-backdrop" @click.self="closeSourceModal">
      <div class="source-modal">
        <div class="source-modal-header">
          <h3>Выбор источника KinoBD</h3>
          <button class="source-close-btn" @click="closeSourceModal">×</button>
        </div>
        <div v-if="sourceLoading" class="source-loading">Загрузка источников...</div>
        <div v-else-if="sourceError" class="source-error">{{ sourceError }}</div>
        <div v-else-if="sourceCandidates.length === 0" class="source-empty">Источники не найдены</div>
        <ul v-else class="source-candidate-list">
          <li v-for="candidate in sourceCandidates" :key="candidate.id">
            <button class="source-candidate-btn" @click="applySourceCandidate(candidate)">
              <span class="source-title">{{ candidate.title || `ID ${candidate.id}` }}</span>
              <span class="source-meta">inid: {{ candidate.id }} · kp: {{ candidate.kp_id || '-' }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <div v-if="progressLabel" class="progress-resume">
      Остановился: <strong>{{ progressLabel }}</strong>
    </div>

    <!-- Единый контейнер плеера -->
    <div
      ref="containerRef"
      :class="['player-container', { 'theater-mode': theaterMode }]"
      :style="!theaterMode ? containerStyle : {}"
    >
      <div class="iframe-wrapper" :style="!theaterMode ? iframeWrapperStyle : {}">
        <iframe
          v-show="!iframeLoading && selectedPlayerInternal?.iframe"
          ref="playerIframe"
          :src="selectedPlayerInternal?.iframe"
          :title="movieInfo?.title ? `Плеер для ${movieInfo.title}` : 'Видео-плеер'"
          frameborder="0"
          allowfullscreen
          webkitallowfullscreen
          class="responsive-iframe"
          :class="{
            'theater-mode-unlock': closeButtonVisible,
            'theater-mode-lock': theaterMode,
            dimmed: dimmingEnabled
          }"
          @load="onIframeLoad"
          @error="onIframeError"
        ></iframe>
        <SpinnerLoading
          v-if="iframeLoading"
          :text="`Загружается плеер: ${selectedPlayerInternal ? getProviderDisplayName(selectedPlayerInternal) : 'Загружается список плееров'}\nЕсли плеер не грузится, то смените плеер выше или включите VPN`"
          style="white-space: pre-line"
        />
        <!-- Плееры не найдены ни в одном источнике -->
        <div
          v-if="!iframeLoading && !selectedPlayerInternal && playersInternal.length === 0"
          class="no-players-msg"
        >
          <span class="no-players-icon">🎬</span>
          <p>Плееры для этого фильма пока недоступны</p>
          <p class="no-players-sub">Попробуйте позже или поищите фильм в другом месте</p>
        </div>
      </div>

      <!-- Кнопка закрытия в театральном режиме -->
      <button
        v-if="theaterMode"
        class="close-theater-btn"
        :class="{ visible: closeButtonVisible }"
        @click="toggleTheaterMode"
      >
        ✖
      </button>
    </div>

    <!-- Кнопки управления -->
    <div v-if="!theaterMode" class="controls">
      <div class="main-controls">
        <div
          v-if="!isMobile && kp_id && showFavoriteTooltip"
          class="tooltip-container"
          data-tooltip-container="favorite"
        >
          <button
            class="favorite-btn"
            :class="{ active: isFavorite }"
            @mouseenter="showTooltip('favorite')"
            @mouseleave="activeTooltip = null"
            @click="toggleFavorite"
          >
            <AppIcon name="heart" :size="20" :filled="isFavorite" />
          </button>
          <div v-show="activeTooltip === 'favorite'" class="custom-tooltip" data-tooltip="favorite">
            {{ isFavorite ? 'Убрать из избранного' : 'В избранное' }}
          </div>
        </div>

        <template v-if="!isMobile">
          <div class="tooltip-container" data-tooltip-container="dimming">
            <button
              class="dimming-btn"
              :class="{ active: dimmingEnabled }"
              @mouseenter="showTooltip('dimming')"
              @mouseleave="activeTooltip = null"
              @click="toggleDimming"
            >
              <AppIcon :name="dimmingEnabled ? 'lightMode' : 'darkMode'" :size="20" />
            </button>
            <div v-show="activeTooltip === 'dimming'" class="custom-tooltip" data-tooltip="dimming">
              {{ dimmingEnabled ? 'Отключить затемнение' : 'Включить затемнение' }}
            </div>
          </div>

          <div class="tooltip-container" data-tooltip-container="theater">
            <button
              class="theater-mode-btn"
              @mouseenter="showTooltip('theater')"
              @mouseleave="activeTooltip = null"
              @click="toggleTheaterMode"
            >
              <AppIcon :name="theaterMode ? 'collapse' : 'expand'" :size="20" />
            </button>
            <div v-show="activeTooltip === 'theater'" class="custom-tooltip" data-tooltip="theater">
              {{ theaterMode ? 'Выйти из театрального режима' : 'Театральный режим' }}
              <span class="shortcut-hint">Alt+T</span>
            </div>
          </div>

          <div class="tooltip-container" data-tooltip-container="aspect_ratio">
            <button
              class="aspect-ratio-dropdown-btn"
              @mouseenter="showTooltip('aspect_ratio')"
              @mouseleave="tryHideTooltip"
              @click="cycleAspectRatio"
            >
              <span class="current-ratio">{{ aspectRatio }}</span>
            </button>
            <div
              v-show="activeTooltip === 'aspect_ratio'"
              class="custom-tooltip advanced-tooltip aspect-ratio-dropdown"
              data-tooltip="aspect_ratio"
              @mouseenter="keepTooltipVisible"
              @mouseleave="hideTooltip"
            >
              <div
                v-for="ratio in aspectRatios"
                :key="ratio"
                class="aspect-ratio-option"
                :class="{ active: aspectRatio === ratio }"
                @click="setAspectRatio(ratio)"
              >
                {{ ratio }}
              </div>
            </div>
          </div>

          <!-- Кнопка центрирования с SliderRound в подсказке -->
          <div
            class="tooltip-container"
            data-tooltip-container="centering"
            @mouseenter="showTooltip('centering')"
            @mouseleave="tryHideTooltip"
          >
            <button class="center-btn" @click="centerPlayer">
              <AppIcon name="screen" :size="20" />
            </button>
            <div
              v-show="activeTooltip === 'centering'"
              class="custom-tooltip advanced-tooltip"
              data-tooltip="centering"
              @mouseenter="keepTooltipVisible"
              @mouseleave="hideTooltip"
            >
              Отцентрировать плеер
              <SliderRound v-model="isCentered" title="Автоцентрирование плеера" />
              <span class="tooltip-title">Автоцентрирование плеера</span>
            </div>
          </div>

          <!-- Кнопка для открытия в приложении -->
          <div
            v-if="!isDesktopApp && kp_id"
            class="tooltip-container"
            data-tooltip-container="app_link"
          >
            <button
              class="app-link-btn"
              @mouseenter="showTooltip('app_link')"
              @mouseleave="activeTooltip = null"
              @click="openAppLink"
            >
              <AppIcon name="externalLink" :size="20" />
            </button>
            <div
              v-show="activeTooltip === 'app_link'"
              class="custom-tooltip"
              data-tooltip="app_link"
            >
              Открыть в приложении
            </div>
          </div>

          <div v-if="selectedPlayerInternal?.iframe" class="tooltip-container" data-tooltip-container="mpv">
            <button
              class="mpv-btn"
              @mouseenter="showTooltip('mpv')"
              @mouseleave="activeTooltip = null"
              @click="copyMpvLink"
            >
              <AppIcon name="terminal" :size="20" />
            </button>
            <div v-show="activeTooltip === 'mpv'" class="custom-tooltip" data-tooltip="mpv">
              Скопировать для mpv
            </div>
          </div>

        </template>
      </div>

      <div v-if="!isMobile && !showFavoriteTooltip && kp_id" class="desktop-list-buttons">
        <div class="tooltip-container">
          <button
            class="favorite-btn"
            :class="{ active: isFavorite }"
            @mouseenter="showTooltip('favorite')"
            @mouseleave="activeTooltip = null"
            @click="toggleFavorite"
          >
            <AppIcon name="heart" :size="20" :filled="isFavorite" />
          </button>
          <div v-show="activeTooltip === 'favorite'" class="custom-tooltip">
            {{ isFavorite ? 'Убрать из избранного' : 'В избранное' }}
          </div>
        </div>
      </div>
    </div>

    <Notification ref="notificationRef" />
  </template>
</template>

<script setup>
import {
  getPlayers,
  searchKinoBDPlayerCandidates,
  getKinoBDPlayerDataByInid
} from '@/api/movies'
import { handleApiError } from '@/constants'
import { resetPinnedHost } from '@/utils/playerHost'
import AppIcon from '@/components/icons/AppIcon.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import SpinnerLoading from '@/components/SpinnerLoading.vue'
import Notification from '@/components/notification/ToastMessage.vue'
import SliderRound from '@/components/slider/SliderRound.vue'
import { useMainStore } from '@/store/main'
import { usePlayerStore } from '@/store/player'
import { useFavoritesStore } from '@/store/favorites'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import PlayerModal from '@/components/PlayerModal.vue'
import { hasAllohaUhd } from '@/api/playerQuality'
import { getWatchProgress, saveWatchProgress } from '@/api/user'
import { formatProgress, playerFamily, summarizeProgress } from '@/utils/watchProgress'

const mainStore = useMainStore()
const playerStore = usePlayerStore()
const favoritesStore = useFavoritesStore()
const route = useRoute()
const kp_id = ref(route.params.kp_id)

const props = defineProps({
  kpId: String,
  movieInfo: {
    type: Object,
    default: () => ({})
  }
})
const emit = defineEmits(['update:selectedPlayer', 'update:movieInfo'])

const playersInternal = ref([])
const selectedPlayerInternal = ref(null)
const iframeLoading = ref(true)
const theaterMode = ref(false)
const closeButtonVisible = ref(false)
const playerIframe = ref(null)
const containerRef = ref(null)
const showPlayerModal = ref(false)
const showSourceModal = ref(false)
const sourceCandidates = ref([])
const sourceLoading = ref(false)
const sourceError = ref('')

// Переменные для ошибок
const errorMessage = ref('')
const errorCode = ref(null)

const maxPlayerHeightValue = ref(window.innerHeight * 0.9)
const maxPlayerHeight = computed(() => `${maxPlayerHeightValue.value}px`)
const isMobile = computed(() => mainStore.isMobile)
// «Открыто в приложении» — для кнопки «Открыть в приложении»,
// которой внутри самого приложения быть не должно.
const isDesktopApp = typeof window !== 'undefined' && !!window.electronAPI
const isKinoBdProvider = computed(() => mainStore.contentApiProvider === 'kinobd')

const activeTooltip = ref(null)
const tooltipHovered = ref(false)
let hideTimeout = null

const notificationRef = ref(null)

const updateTooltipPosition = (tooltipName) => {
  const container = document.querySelector(`[data-tooltip-container="${tooltipName}"]`)
  const tooltip = document.querySelector(`[data-tooltip="${tooltipName}"]`)
  if (!container || !tooltip) return

  const containerRect = container.getBoundingClientRect()
  const tooltipRect = tooltip.getBoundingClientRect()
  const viewportHeight = window.innerHeight

  if (containerRect.bottom + tooltipRect.height > viewportHeight) {
    tooltip.style.top = 'auto'
    tooltip.style.bottom = '100%'
    tooltip.style.marginTop = '0'
    tooltip.style.marginBottom = '12px'
    tooltip.style.transform = 'translateX(-50%)'
  } else {
    tooltip.style.top = '100%'
    tooltip.style.bottom = 'auto'
    tooltip.style.marginTop = '12px'
    tooltip.style.marginBottom = '0'
    tooltip.style.transform = 'translateX(-50%)'
  }
}

const showTooltip = (tooltipName) => {
  activeTooltip.value = tooltipName
  tooltipHovered.value = false
  clearTimeout(hideTimeout)
  nextTick(() => {
    updateTooltipPosition(tooltipName)
  })
}

const tryHideTooltip = () => {
  if (!tooltipHovered.value) {
    hideTimeout = setTimeout(() => {
      activeTooltip.value = null
    }, 300)
  }
}

const keepTooltipVisible = () => {
  tooltipHovered.value = true
  clearTimeout(hideTimeout)
}

const hideTooltip = () => {
  tooltipHovered.value = false
  activeTooltip.value = null
}

const aspectRatio = computed({
  get: () => playerStore.aspectRatio,
  set: (value) => playerStore.updateAspectRatio(value)
})

const isCentered = computed({
  get: () => playerStore.isCentered,
  set: (value) => playerStore.updateCentering(value)
})

// Состояние избранного — из того же стора, что и кнопка на странице фильма.
// Раньше плеер читал movieInfo.lists — поле старого API rhserv, которое наш
// бэкенд не отдаёт: сердечко не подсвечивалось, а убрать из плеера было нельзя.
const isFavorite = computed(() => favoritesStore.isFavorite(kp_id.value))

const preferredPlayer = computed(() => playerStore.preferredPlayer)
const naturalHeight = ref(0)

const normalizeKey = (key) => key.toUpperCase()

// ALLOHA была здесь с первого коммита без объяснения. Выяснилось, что это
// единственный балансер с настоящим 4K: 2160p и 1440p в меню качества,
// 3840x2160 AV1 в плейлисте, у большинства популярных тайтлов. Реферер
// приложения плеер принимает. Если вернётся проблема, из-за которой её
// выключали, — сначала записать причину, потом блокировать.
const BLOCKED_PLAYERS = ['FLIXCDN']

// Приоритет плееров: чем раньше в списке — тем выше (и тем вероятнее станет дефолтным).
// Turbo — самый стабильный/быстрый, поэтому он первый для обычного кино.
const PLAYER_PRIORITY = ['TURBO', 'COLLAPS', 'KODIK', 'VIBIX', 'VIDEOSEED', 'СЫЕНДУК']

const playerPriorityIndex = (player) => {
  const list = PLAYER_PRIORITY
  const name = normalizeKey(`${getProviderDisplayName(player)} ${player.key}`)
  const idx = list.findIndex((p) => name.includes(p))
  // Не найденные — в конец, но сохраняя исходный порядок
  return idx === -1 ? list.length + 1 : idx
}

// Метка «4K» в выборе плеера. Выбор по умолчанию не меняется — первым
// остаётся TURBO; метка лишь подсказывает, где есть 2160p и 1440p.
const markUhdPlayers = async () => {
  const list = playersInternal.value
  const alloha = list.find((player) => /ALLOHA/.test(player.key))
  if (!alloha?.iframe) return
  const uhd = await hasAllohaUhd(alloha.iframe)
  // Пока ждали ответ, могли открыть другой фильм — чужую метку не ставим.
  if (uhd && playersInternal.value === list) alloha.uhd = true
}

const applyPlayersData = (players) => {
  const dedupedPlayers = []
  const seenProviders = new Set()

  for (const [key, value] of Object.entries(players || {})) {
    const player = {
      key: key.toUpperCase(),
      ...value
    }

    // Фильтруем заблокированные плееры
    const providerName = normalizeKey(getProviderDisplayName(player))
    if (BLOCKED_PLAYERS.some(blocked => providerName.includes(blocked) || player.key.includes(blocked))) {
      continue
    }

    if (providerName && seenProviders.has(providerName)) {
      continue
    }
    if (providerName) {
      seenProviders.add(providerName)
    }
    dedupedPlayers.push(player)
  }

  // Сортируем по приоритету (стабильная сортировка сохраняет исходный порядок
  // для плееров с одинаковым приоритетом)
  dedupedPlayers.sort((a, b) => playerPriorityIndex(a) - playerPriorityIndex(b))

  playersInternal.value = dedupedPlayers
  // Новый список плееров — сбрасываем историю авто-скипов
  autoTriedKeys.value = new Set()
  markUhdPlayers()

  if (playersInternal.value.length === 0) return

  // Пробуем восстановить ранее выбранный плеер для этого фильма
  let restoredFromStorage = null
  try {
    if (typeof window !== 'undefined' && props.kpId) {
      const stored = window.localStorage.getItem(`abobatv_selected_player_${props.kpId}`)
      if (stored) {
        restoredFromStorage = playersInternal.value.find((p) => p.key === stored)
      }
    }
  } catch (error) {
    console.warn('[player] не удалось прочитать выбранный плеер:', error?.message || error)
  }

  if (restoredFromStorage) {
    selectedPlayerInternal.value = restoredFromStorage
  } else if (preferredPlayer.value) {
    const normalizedPreferred = normalizeKey(preferredPlayer.value)
    const preferred = playersInternal.value.find(
      (player) =>
        normalizeKey(player.key) === normalizedPreferred ||
        normalizeKey(getProviderDisplayName(player)) === normalizedPreferred
    )
    selectedPlayerInternal.value = preferred || playersInternal.value[0]
  } else {
    selectedPlayerInternal.value = playersInternal.value[0]
  }
  emit('update:selectedPlayer', selectedPlayerInternal.value)
}

const updateScaleFactor = () => {
  if (theaterMode.value || !containerRef.value) return
  const [w, h] = aspectRatio.value.split(':').map(Number)
  maxPlayerHeightValue.value = window.innerHeight * 0.9
  naturalHeight.value = Math.min(
    containerRef.value.clientWidth * (h / w),
    maxPlayerHeightValue.value
  )
}

const containerStyle = computed(() => {
  if (theaterMode.value) return {}
  const [w, h] = aspectRatio.value.split(':').map(Number)
  const maxWidth = maxPlayerHeightValue.value * (w / h)
  return {
    width: '100%',
    maxWidth: `${maxWidth}px`,
    maxHeight: maxPlayerHeight.value,
    margin: '0 auto',
    overflow: 'hidden'
  }
})

const iframeWrapperStyle = computed(() => {
  const [w, h] = aspectRatio.value.split(':').map(Number)
  return {
    position: 'relative',
    width: '100%',
    paddingTop: `${(h / w) * 100}%`
  }
})

const centerPlayer = () => {
  if (containerRef.value) {
    setTimeout(() => {
      nextTick(() => {
        containerRef.value.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'center'
        })
      })
    }, 500)
  }
}

const fetchPlayers = async () => {
  try {
    errorMessage.value = ''
    errorCode.value = null

    // Таймаут 20 секунд — учитываем VPN пользователей у которых загрузка медленнее
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 20000)
    )

    const savedInid = playerStore.kinobdSourceByKpId?.[String(props.kpId)] || null
    const players = await Promise.race([
      getPlayers(props.kpId, {
        mode: 'kp_id',
        usePlayerData: true,
        forceInid: isKinoBdProvider.value ? savedInid : null
      }),
      timeout
    ])
    applyPlayersData(players)
    // Если после всех источников плееров нет — останавливаем спираль
    if (playersInternal.value.length === 0) {
      iframeLoading.value = false
    }
  } catch (error) {
    iframeLoading.value = false
    if (error?.message === 'timeout') {
      errorMessage.value = 'Плееры не найдены для этого фильма. Попробуйте другой фильм или включите VPN.'
      errorCode.value = 404
    } else if (error?.allSourcesDown) {
      // Важно отличать от «плееров нет»: тут фильм ни при чём, лежат источники.
      // Раньше оба случая выглядели одинаково — пустой список без объяснений.
      errorMessage.value =
        'Источники видео сейчас недоступны. Это временно — попробуйте обновить страницу через пару минут.'
      errorCode.value = 503
    } else {
      const { message, code } = handleApiError(error)
      errorMessage.value = message
      errorCode.value = code
    }
    console.error('Ошибка при загрузке плееров:', error)
  }
}

const openPlayerModal = () => {
  showPlayerModal.value = true
}

const closePlayerModal = () => {
  showPlayerModal.value = false
}

const openSourceModal = async () => {
  showSourceModal.value = true
  sourceError.value = ''
  sourceLoading.value = true

  try {
    const query =
      props.movieInfo?.title ||
      props.movieInfo?.name_ru ||
      props.movieInfo?.name_en ||
      props.movieInfo?.name_original ||
      props.kpId

    let candidates = []
    if (query) {
      candidates = await searchKinoBDPlayerCandidates(query, { type: 'title', page: 1 })
    }
    if (!candidates.length && props.kpId) {
      candidates = await searchKinoBDPlayerCandidates(props.kpId, { type: 'kp_id', page: 1 })
    }
    sourceCandidates.value = candidates
  } catch (error) {
    sourceError.value = 'Не удалось загрузить список источников'
    console.error('Ошибка при загрузке источников KinoBD:', error)
  } finally {
    sourceLoading.value = false
  }
}

const closeSourceModal = () => {
  showSourceModal.value = false
}

const applySourceCandidate = async (candidate) => {
  if (!candidate?.id) return

  sourceLoading.value = true
  sourceError.value = ''

  try {
    const players = await getKinoBDPlayerDataByInid(candidate.id, {
      playerUrl: candidate.iframe
    })
    applyPlayersData(players)
    playerStore.setKinoBdSource(props.kpId, candidate.id)
    closeSourceModal()
  } catch (error) {
    sourceError.value = 'Не удалось применить выбранный источник'
    console.error('Ошибка применения источника KinoBD:', error)
  } finally {
    sourceLoading.value = false
  }
}

const toggleTheaterMode = () => {
  theaterMode.value = !theaterMode.value
  if (theaterMode.value) {
    window.addEventListener('mousemove', showCloseButton)
    document.addEventListener('keydown', onKeyDown)
    document.body.classList.add('no-scroll')
  } else {
    window.removeEventListener('mousemove', showCloseButton)
    document.removeEventListener('keydown', onKeyDown)
    document.body.classList.remove('no-scroll')
  }
  closeButtonVisible.value = theaterMode.value
  nextTick(() => {
    centerPlayer()
    if (playerIframe.value) {
      playerIframe.value.focus()
    }
  })
}

const theaterModeCloseButtonTimeout = ref(null)
const showCloseButton = () => {
  theaterModeCloseButtonTimeout.value = setTimeout(() => {
    clearTimeout(theaterModeCloseButtonTimeout.value)
    closeButtonVisible.value = false
  }, 4000)
  closeButtonVisible.value = true
}

const dimmingEnabled = computed(() => mainStore.dimmingEnabled)
const toggleDimming = () => {
  if (!theaterMode.value) {
    mainStore.toggleDimming()
  }
}

const onIframeLoad = () => {
  iframeLoading.value = false
  clearLoadWatchdog()
}

const onKeyDown = (event) => {
  if (event.key === 'Escape' && theaterMode.value) {
    toggleTheaterMode()
  } else if (event.altKey && event.keyCode === 84) {
    toggleTheaterMode()
  }
}

const setAspectRatio = (ratio) => {
  aspectRatio.value = ratio
  setTimeout(() => {
    if (isCentered.value) centerPlayer()
  }, 310)
}

const openAppLink = () => {
  const appUrl = `abobatv://#${kp_id.value}`
  try {
    window.location.href = appUrl
  } catch (e) {
    console.error('Ошибка при открытии ссылки:', e)
  }
}

const getBestMpvStreamUrl = (player) => {
  if (!player) return ''

  const directCandidates = [player.hls, player.stream, player.url, player.file, player.src].filter(
    (v) => typeof v === 'string' && v
  )
  const direct = directCandidates.find(
    (v) => /\.m3u8(\?|$)/i.test(v) || /manifest/i.test(v) || /\/hls\//i.test(v)
  )
  if (direct) return direct

  const raw = player.raw_data
  if (raw && typeof raw === 'object') {
    const queue = [raw]
    const visited = new Set()

    while (queue.length) {
      const cur = queue.shift()
      if (!cur || typeof cur !== 'object') continue
      if (visited.has(cur)) continue
      visited.add(cur)

      for (const value of Object.values(cur)) {
        if (!value) continue
        if (typeof value === 'string') {
          if (
            /^https?:\/\//i.test(value) &&
            (/\.m3u8(\?|$)/i.test(value) || /manifest/i.test(value) || /\/hls\//i.test(value))
          ) {
            return value
          }
        } else if (typeof value === 'object') {
          queue.push(value)
        }
      }
    }
  }

  const iframeUrl = String(player.iframe || '')
  if (!iframeUrl) return ''

  try {
    const parsed = new URL(iframeUrl)
    const queryValues = []
    parsed.searchParams.forEach((value) => queryValues.push(value))
    for (const value of queryValues) {
      if (/^https?:\/\//i.test(value) && /\.m3u8(\?|$)/i.test(value)) {
        return value
      }
    }
  } catch {
    return ''
  }

  return ''
}

const copyText = async (text) => {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const copyMpvLink = async () => {
  const current = selectedPlayerInternal.value
  if (!current) return

  const streamUrl = getBestMpvStreamUrl(current)
  const targetUrl = streamUrl || String(current.iframe || '')

  if (!targetUrl) {
    notificationRef.value.showNotification('Не удалось получить ссылку для mpv')
    return
  }

  const referrer = (() => {
    try {
      const base = new URL(String(current.iframe || ''))
      return `${base.origin}/`
    } catch {
      return ''
    }
  })()

  const mpvCommand = referrer
    ? `mpv --referrer="${referrer}" "${targetUrl}"`
    : `mpv "${targetUrl}"`

  const ok = await copyText(mpvCommand)
  if (ok) {
    notificationRef.value.showNotification('Команда mpv скопирована')
    return
  }

  const linkOk = await copyText(targetUrl)
  if (linkOk) {
    notificationRef.value.showNotification('Ссылка для mpv скопирована')
    return
  }

  notificationRef.value.showNotification('Не удалось скопировать ссылку для mpv')
}

function cleanName(name) {
  const cleanedName = String(name || '')
    .replace(/KODIK>/, 'Kodik - ')
    .replace(/VEOVEO>/, 'VeoVeo - ')
    .replace(/KINOBOX>/, '')
    .trim()
  return cleanedName
}

function getProviderName(player) {
  const directProvider = String(player?.provider || '').trim()
  if (directProvider) return cleanName(directProvider)

  const rawName = String(player?.name || player?.key || '')
  // Плееры из /playerdata kinobd называются просто ключом: «ALLOHA», «COLLAPS».
  // Раньше здесь возвращалась пустота, и на кнопке вместо «ALLOHA» стояла
  // вся строка озвучек: «Украинский, Дубляж Red Head Sound, LostFilm, …».
  if (!rawName.includes('>')) return cleanName(rawName)

  const segments = rawName
    .split('>')
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (!segments.length) return ''

  const root = segments[0].toUpperCase()
  if ((root === 'KINOBOX' || root === 'KINOBD' || root === 'RHSERV') && segments[1]) {
    return cleanName(segments[1])
  }

  return cleanName(segments[0])
}

function getProviderDisplayName(player) {
  const provider = getProviderName(player)
  return provider || cleanName(player?.translate) || 'Плеер'
}

const handlePlayerSelect = (player) => {
  if (selectedPlayerInternal.value?.key === player.key) {
    closePlayerModal()
    return
  }

  selectedPlayerInternal.value = player

  // Сохраняем выбранный плеер чтобы при следующем заходе на этот же фильм
  // он подгрузился автоматически
  try {
    if (typeof window !== 'undefined' && props.kpId && player.key) {
      const key = `abobatv_selected_player_${props.kpId}`
      window.localStorage.setItem(key, player.key)
    }
  } catch (error) {
    console.warn('[player] не удалось сохранить выбранный плеер:', error?.message || error)
  }

  iframeLoading.value = true
  playerStore.updatePreferredPlayer(normalizeKey(player.key))
  emit('update:selectedPlayer', player)
}

// ── Авто-скип зависших плееров ───────────────────────────────────────────
// Если iframe не загрузился за LOAD_TIMEOUT_MS — источник, скорее всего, мёртв
// (висит). Пробуем следующий по приоритету. Это ловит зависшие источники;
// «загрузился, но внутри ошибка» поймать нельзя (cross-origin), но дефолт
// на Turbo делает это редкостью.
const LOAD_TIMEOUT_MS = 12000
let loadWatchdog = null
const autoTriedKeys = ref(new Set())

const clearLoadWatchdog = () => {
  if (loadWatchdog) {
    clearTimeout(loadWatchdog)
    loadWatchdog = null
  }
}

const goToNextWorkingPlayer = () => {
  const cur = selectedPlayerInternal.value
  if (!cur) return
  autoTriedKeys.value.add(cur.key)
  const next = playersInternal.value.find(
    (p) => p.key !== cur.key && !autoTriedKeys.value.has(p.key)
  )
  if (next) {
    console.debug('[player] авто-скип зависшего источника', cur.key, '→', next.key)
    selectedPlayerInternal.value = next
  }
}

const startLoadWatchdog = () => {
  clearLoadWatchdog()
  loadWatchdog = setTimeout(() => {
    if (iframeLoading.value) goToNextWorkingPlayer()
  }, LOAD_TIMEOUT_MS)
}

const onIframeError = () => {
  // Закреплённый поддомен мог попасть под блокировку — сбрасываем, чтобы
  // следующая ссылка закрепила новый (см. utils/playerHost.js).
  resetPinnedHost(selectedPlayerInternal.value?.iframe)
  // Сетевой сбой iframe — сразу пробуем следующий
  if (iframeLoading.value) goToNextWorkingPlayer()
}

// ── Серия и таймкод ──
// Позицию помнит сам плеер у себя в iframe. Приложение раз в 15 секунд
// забирает её оттуда (через главный процесс) и кладёт в базу, откуда она
// синхронизируется на другие компьютеры. При открытии — кладёт обратно.
const PROGRESS_SAVE_MS = 15000
const progressSupported = isDesktopApp && !!window.electronAPI?.player
// Показать, где остановился, можно в любом браузере (телефон по Wi-Fi):
// позиция уже лежит в базе. А вот забрать её из плеера и вернуть обратно
// умеет только приложение — браузер не пускает в окно чужого сайта.
const savedProgress = ref(null)
const progressLabel = computed(() => formatProgress(savedProgress.value?.summary))
let progressTimer = null
let lastProgressSnapshot = ''
let progressKpId = ''
const progressIssueAt = new Map()
const progressToastShown = new Set()

const reportProgressIssue = (stage, error, notify = false) => {
  const now = Date.now()
  if (now - (progressIssueAt.get(stage) || 0) > 60_000) {
    console.warn(`[progress] ${stage}:`, error?.message || error || 'неизвестная ошибка')
    progressIssueAt.set(stage, now)
  }
  if (notify && !progressToastShown.has(stage)) {
    progressToastShown.add(stage)
    window.__toast?.('Не удалось синхронизировать позицию просмотра', 6000)
  }
}

const hasAuthToken = () => {
  try {
    return !!JSON.parse(window.localStorage.getItem('auth') || '{}')?.token
  } catch {
    return false
  }
}

const loadSavedProgress = async () => {
  progressKpId = String(props.kpId || kp_id.value || '')
  savedProgress.value = null
  lastProgressSnapshot = ''
  if (!progressKpId || !hasAuthToken()) return
  try {
    const { payload } = await getWatchProgress(progressKpId)
    if (payload && typeof payload === 'object' && payload.players) savedProgress.value = payload
  } catch (error) {
    // Нет сохранённой позиции или бэкенд занят — смотреть это не мешает.
    reportProgressIssue('загрузка позиции', error, true)
  }
  if (!progressSupported) return
  // Плеер читает позицию в первые же мгновения загрузки, поэтому готовим её
  // для всех плееров сразу, ещё до того, как выбран какой-то из них.
  const players = savedProgress.value?.players || {}
  await Promise.all(
    Object.entries(players).map(([family, saved]) =>
      saved?.entries ? sendRestore(saved.frames || saved.entries, `https://player.${family}/`, saved.summary) : null
    )
  )
}

// Через мост Electron проходят только обычные объекты: реактивный Proxy
// из Vue он скопировать не может и падает прямо в момент вызова.
const plain = (value) => JSON.parse(JSON.stringify(value))

// summary — где остановился (время, длительность): по нему плеер
// перематывается при первом запуске, если сам начал с нуля.
const sendRestore = async (entries, src, summary) => {
  try {
    const resume = summary ? { time: summary.time, duration: summary.duration } : null
    return await window.electronAPI.player.restoreProgress(plain(entries), src, resume)
  } catch (error) {
    reportProgressIssue('восстановление позиции в плеере', error)
    return false
  }
}

const restoreProgressFor = (player) => {
  const family = playerFamily(player?.iframe)
  const saved = savedProgress.value?.players?.[family]
  if (!progressSupported || !saved?.entries) return
  // frames — записи по окнам плеера (VIBIX хранит позицию во вложенном окне);
  // у позиций, сохранённых раньше, есть только общий набор entries.
  sendRestore(saved.frames || saved.entries, player.iframe, saved.summary)
}

const saveProgress = async () => {
  const src = selectedPlayerInternal.value?.iframe
  const kpId = progressKpId
  if (!progressSupported || !src || !kpId || !hasAuthToken()) return
  let snapshot = null
  try {
    snapshot = await window.electronAPI.player.readProgress(src)
  } catch (error) {
    reportProgressIssue('чтение позиции из плеера', error)
    return
  }
  const entries = snapshot?.entries
  if (!entries || !Object.keys(entries).length) return
  const serialized = JSON.stringify(entries)
  if (serialized === lastProgressSnapshot) return
  const summary = summarizeProgress(entries)
  const family = playerFamily(src)
  const current = savedProgress.value || { v: 1, players: {} }
  const next = {
    v: 1,
    players: {
      ...current.players,
      [family]: {
        entries,
        frames: snapshot.frames || null,
        summary,
        player: selectedPlayerInternal.value?.key || '',
        saved_at: Date.now()
      }
    },
    summary: summary || current.summary || null,
    updated_player: family
  }
  try {
    await saveWatchProgress(kpId, next)
    lastProgressSnapshot = serialized
    savedProgress.value = next
  } catch (error) {
    // Повторим на следующем тике.
    reportProgressIssue('сохранение позиции', error, true)
  }
}

watch(selectedPlayerInternal, (newVal) => {
  if (newVal) {
    restoreProgressFor(newVal)
    iframeLoading.value = true
    playerStore.updatePreferredPlayer(normalizeKey(newVal.key))
    emit('update:selectedPlayer', newVal)
    startLoadWatchdog()
  }
})

watch(
  () => route.params.kp_id,
  async (newKpId) => {
    if (newKpId && newKpId !== kp_id.value) {
      // Позицию прошлого фильма дописываем до того, как переключиться.
      await saveProgress()
      kp_id.value = newKpId
      loadSavedProgress()
      if (isCentered.value) centerPlayer()
    }
  },
  { immediate: true }
)

const aspectRatios = ['16:9', '12:5', '4:3']

const cycleAspectRatio = () => {
  const currentIndex = aspectRatios.indexOf(aspectRatio.value)
  const nextIndex = (currentIndex + 1) % aspectRatios.length
  setAspectRatio(aspectRatios[nextIndex])
}

const toggleFavorite = async () => {
  const id = kp_id.value
  if (!id) return
  const info = props.movieInfo || {}
  const wasFavorite = isFavorite.value
  try {
    await favoritesStore.toggle({
      kp_id: id,
      title: info.name_ru || info.title || '',
      slug: info.slug || '',
      year: info.year || '',
      type: info.type || '',
      poster: info.cover || info.poster || info.poster_url_preview || '',
      rating_kp: info.rating_kinopoisk || info.rating_kp || '',
      rating_imdb: info.rating_imdb || ''
    })
    notificationRef.value?.showNotification(
      wasFavorite ? 'Удалено из избранного' : 'Добавлено в избранное'
    )
  } catch (error) {
    console.error('[favorites] update failed:', error)
    notificationRef.value?.showNotification('Не удалось изменить избранное')
  }
}

const showFavoriteTooltip = computed(() => playerStore.showFavoriteTooltip)

onMounted(async () => {
  if (progressSupported) {
    progressTimer = setInterval(() => {
      void saveProgress().catch((error) => reportProgressIssue('фоновое сохранение', error, true))
    }, PROGRESS_SAVE_MS)
  }

  iframeLoading.value = true
  if (isMobile.value) aspectRatio.value = '4:3'
  updateScaleFactor()
  window.addEventListener('resize', updateScaleFactor)
  window.addEventListener('resize', updateTooltipPosition)
  if (isCentered.value) centerPlayer()
  // Позиция — локальный запрос на доли секунды; ждём её не дольше полутора
  // секунд, чтобы медленный бэкенд не задерживал сам плеер.
  await Promise.race([
    loadSavedProgress().catch((error) => reportProgressIssue('загрузка позиции', error, true)),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ])
  fetchPlayers()
})

onBeforeUnmount(() => {
  clearInterval(progressTimer)
  void saveProgress().catch((error) => reportProgressIssue('финальное сохранение', error, true))

  window.removeEventListener('resize', updateScaleFactor)
  window.removeEventListener('resize', updateTooltipPosition)
  window.removeEventListener('mousemove', showCloseButton)
  document.removeEventListener('keydown', onKeyDown)
  document.body.classList.remove('no-scroll')
})
</script>

<style scoped>
.progress-resume {
  max-width: 800px;
  margin: 0 auto 10px;
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(var(--accent-rgb), 0.06);
  border: 1px solid rgba(var(--accent-rgb), 0.18);
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  text-align: center;
}

.progress-resume strong {
  color: #fff;
  font-weight: 600;
}

.players-list {
  width: 100%;
  max-width: 800px;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 auto 10px;
}

/* Панель плеера — новый стиль "Плеер: Turbo | изменить ›" */
.uhd-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.4;
  color: #0a0e1a;
  background: var(--accent-color, #00e5ff);
}

.player-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(255,255,255,0.04);
  color: var(--text-color);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s;
  width: 100%;
  max-width: 800px;
  text-align: left;

  &::before {
    content: 'Плеер:';
    color: rgba(255,255,255,0.35);
    font-weight: 400;
    flex-shrink: 0;
  }

  &::after {
    content: 'изменить ›';
    margin-left: auto;
    font-size: 11px;
    color: rgba(255,255,255,0.22);
    flex-shrink: 0;
  }
}

.player-btn:hover {
  border-color: rgba(var(--accent-rgb),0.28);
  background: rgba(255,255,255,0.06);
  color: var(--accent-color);
}

.player-btn:active,
.player-btn:focus {
  outline: none;
  border-color: var(--accent-color);
}

.source-btn {
  padding: 9px 14px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  background: rgba(255,255,255,0.04);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.18s;
  flex-shrink: 0;
}

/* Телефон: «Плеер: TURBO изменить › | Источник» не помещался и уезжал за экран */
@media (max-width: 600px) {
  .players-list {
    padding: 0 12px;
    box-sizing: border-box;
  }
  .players-list > span {
    display: none;
  }
  .player-btn {
    flex: 1;
    min-width: 0;
    padding: 9px 12px;
  }
  .player-btn::after {
    display: none;
  }
}

.source-btn:hover {
  border-color: rgba(var(--accent-rgb),0.28);
  color: var(--accent-color);
}

.source-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.65);
  backdrop-filter: blur(6px);
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

.source-modal {
  width: min(720px, 100%);
  max-height: 80vh;
  overflow: auto;
  background: #222;
  border: 1px solid #444;
  border-radius: 10px;
  padding: 14px;
}

.source-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.source-modal-header h3 {
  margin: 0;
  font-size: 18px;
}

.source-close-btn {
  background: transparent;
  border: none;
  color: #fff;
  font-size: 26px;
  cursor: pointer;
}

.source-loading,
.source-error,
.source-empty {
  padding: 10px 0;
}

.source-error {
  color: #ff7a7a;
}

.source-candidate-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.source-candidate-btn {
  width: 100%;
  text-align: left;
  background: #333;
  border: 1px solid #4f4f4f;
  color: #fff;
  border-radius: 8px;
  padding: 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.source-candidate-btn:hover {
  border-color: var(--accent-color);
  background: #3a3a3a;
}

.source-title {
  font-weight: 600;
}

.source-meta {
  opacity: 0.8;
  font-size: 12px;
}

.player-container {
  width: 100%;
  transition:
    max-width 0.3s ease-in-out,
    max-height 0.3s ease-in-out;
  overflow: hidden;
  padding-bottom: 10px;
}

.iframe-wrapper {
  transition:
    padding-top 0.3s ease-in-out,
    transform 0.3s ease-in-out;
  width: 100%;
}

.no-players-msg {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: rgba(255,255,255,0.6);
}
.no-players-icon { font-size: 48px; margin-bottom: 16px; }
.no-players-msg p { margin: 4px 0; font-size: 15px; }
.no-players-sub { font-size: 13px; color: rgba(255,255,255,0.35); }

.responsive-iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
  z-index: 4;
}

.responsive-iframe.dimmed {
  z-index: 7;
}

/* Стили для театрального режима */
.player-container.theater-mode {
  position: fixed;
  top: 0 !important;
  left: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  background: #000;
  margin: 0;
  border-radius: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 7;
}

.player-container.theater-mode .iframe-wrapper {
  width: 100% !important;
  height: 100% !important;
  padding-top: 0 !important;
  flex-grow: 1;
}

.close-theater-btn {
  position: fixed;
  top: 20px;
  right: 80px;
  background: rgba(255, 0, 0, 0.7);
  color: white;
  border: none;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  cursor: pointer;
  transition:
    background 0.3s,
    opacity 0.3s;
  opacity: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  z-index: 8;
}

.close-theater-btn.visible {
  opacity: 1;
}

/* Делаем кнопку видимой при наведении на зону */
.close-theater-btn:hover,
.close-theater-btn::before:hover {
  background: var(--accent-color);
  opacity: 1;
}

html.no-scroll {
  overflow: hidden;
}

/* Блока управления */
.controls {
  display: none !important;
}

.main-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.controls button {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #444;
  color: #fff;
  border: none;
  padding: 12px;
  font-size: 18px;
  border-radius: 8px;
  cursor: pointer;
  transition:
    background-color 0.3s ease,
    transform 0.2s ease,
    box-shadow 0.3s ease;
  z-index: 4;
  width: 50px;
  height: 50px;
}

.controls button:hover {
  background-color: var(--accent-color);
  transform: translateY(-3px);
  box-shadow: 0 4px 10px var(--accent-semi-transparent);
}

.controls button:active {
  transform: translateY(0);
  box-shadow: none;
}

.controls button.active {
  background-color: var(--accent-color);
  box-shadow: 0 0 10px var(--accent-semi-transparent);
}

.app-icon {
  flex-shrink: 0;
}

.tooltip-container {
  position: relative;
  display: inline-block;
}

.custom-tooltip {
  position: absolute;
  left: 50%;
  background-color: rgba(30, 30, 30, 0.95);
  color: #fff;
  padding: 8px 16px;
  border-radius: 12px;
  font-size: 14px;
  white-space: nowrap;
  pointer-events: none;
  text-align: center;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  opacity: 0;
  visibility: hidden;
  transform: translateX(-50%) translateY(8px);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 1000;
}

.custom-tooltip::before {
  content: '';
  position: absolute;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 10px;
  height: 10px;
  background-color: rgba(30, 30, 30, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.08);
  z-index: -1;
}

.custom-tooltip[style*='bottom: 100%']::before {
  bottom: -5px;
  top: auto;
}

.custom-tooltip[style*='top: 100%']::before {
  top: -5px;
  bottom: auto;
}

.tooltip-container:hover .custom-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
}

.advanced-tooltip {
  white-space: normal;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  top: calc(100% + 12px);
  pointer-events: all;
  text-align: center;
  min-width: 240px;
  background-color: rgba(30, 30, 30, 0.98);
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.35);
  transform: translateX(-50%) translateY(8px);
}

.advanced-tooltip::before {
  top: -6px;
  width: 12px;
  height: 12px;
}

.tooltip-title {
  font-size: 15px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.95);
  margin-top: 4px;
}

.aspect-ratio-dropdown {
  min-width: fit-content;
  width: max-content;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background-color: rgba(30, 30, 30, 0.98);
  border-radius: 16px;
}

.aspect-ratio-option {
  padding: 12px 20px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  width: 100%;
}

.aspect-ratio-option:hover {
  background-color: var(--accent-color);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px var(--accent-semi-transparent);
}

.aspect-ratio-option.active {
  background-color: var(--accent-color);
  color: white;
  font-weight: 500;
  box-shadow: 0 2px 12px var(--accent-semi-transparent);
}

.theater-mode-lock {
  pointer-events: none;
}

.theater-mode-unlock {
  pointer-events: all;
}

.aspect-ratio-dropdown-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  min-width: 60px;
}

.current-ratio {
  font-size: 14px;
  font-weight: 500;
}


.shortcut-hint {
  display: block;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 6px;
  font-weight: 400;
}

.favorite-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #444;
  color: #fff;
  border: none;
  padding: 12px;
  font-size: 18px;
  border-radius: 8px;
  cursor: pointer;
  transition:
    background-color 0.3s ease,
    transform 0.2s ease,
    box-shadow 0.3s ease;
  z-index: 4;
  width: 50px;
  height: 50px;
  position: relative;
}

.favorite-btn:hover {
  background-color: var(--accent-color);
  transform: translateY(-3px);
  box-shadow: 0 4px 10px var(--accent-semi-transparent);
}

.desktop-list-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 5px;
  margin: 0 auto;
  border-radius: 10px;
  backdrop-filter: blur(10px);
}

.desktop-list-buttons .tooltip-container {
  margin: 0;
}

.desktop-list-buttons button {
  margin: 0;
}

</style>
