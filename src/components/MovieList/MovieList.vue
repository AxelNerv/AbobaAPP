<template>
  <div>
    <div
      v-show="!loading"
      ref="gridRef"
      class="grid"
      :class="[`card-size-${cardSize}`, `variant-${variant}`]"
    >
      <template v-if="(isHistory || isUserList) && isMobile">
        <CardMovieSwipeWrapper
          v-for="(movie, index) in moviesList"
          :key="movie.kp_id"
          :data-test-id="`movie-card-swipe-wrapper-${movie.kp_id}`"
          :show-delete="showDelete"
          @slide="removeFromHistory(movie.kp_id)"
        >
          <CardMovie
            :movie
            :is-history
            :is-mobile
            :is-user-list="isUserList"
            :index
            :is-card-border="isCardBorder"
            :active-movie-index
            :show-delete="showDelete"
            :show-star="showStar"
            :variant="variant"
            @remove:from-history="removeFromHistory"
          />
        </CardMovieSwipeWrapper>
      </template>

      <template v-else>
        <CardMovie
          v-for="(movie, index) in moviesList"
          :key="movie.kp_id"
          :movie
          :is-history="isHistory"
          :is-mobile="isMobile"
          :is-user-list="isUserList"
          :index
          :is-card-border="isCardBorder"
          :active-movie-index
          :show-delete="showDelete"
          :show-star="showStar"
          :variant="variant"
          @remove:from-history="removeFromHistory"
        />
      </template>
    </div>
    <Spinner v-if="loading" />
  </div>
</template>

<script setup>
import Spinner from '@/components/SpinnerLoading.vue'
import { useBackgroundStore } from '@/store/background'
import { useMainStore } from '@/store/main'
import { useAuthStore } from '@/store/auth'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { CardMovie, CardMovieSwipeWrapper } from '../CardMovie'
import { delFromList } from '@/api/user'
import { handleApiError } from '@/constants'
import { USER_LIST_TYPES_ENUM } from '@/constants'
import { getMovieSeoPath } from '@/utils/movieSeo'

const mainStore = useMainStore()
const authStore = useAuthStore()
const backgroundStore = useBackgroundStore()
const router = useRouter()
const route = useRoute()

const {
  moviesList,
  isHistory = false,
  loading = true,
  showDelete = true,
  showStar = false,
  variant = 'default'
} = defineProps({
  moviesList: Array,
  isHistory: Boolean,
  loading: Boolean,
  showDelete: Boolean,
  showStar: Boolean,
  variant: String
})

const activeMovieIndex = ref(null)
const gridRef = ref(null)

const isCardBorder = computed(() => backgroundStore.isCardBorder)
const isMobile = computed(() => mainStore.isMobile)
const cardSize = computed(() => mainStore.cardSize)
const isUserList = computed(() => {
  return (
    route.name === 'lists' &&
    (!route.params.user_id || String(route.params.user_id) === String(authStore.user?.id))
  )
})

const movieUrl = (movie) => {
  return router.resolve(getMovieSeoPath(movie)).href
}

const emit = defineEmits(['item-deleted'])
const removeFromHistory = async (kp_id) => {
  if (authStore.token) {
    try {
      await delFromList(kp_id, USER_LIST_TYPES_ENUM.HISTORY)
      mainStore.removeFromHistory(kp_id)
      emit('item-deleted', kp_id)
    } catch (error) {
      const { code } = handleApiError(error)
      console.error('Ошибка удаления из истории:', error)
      // Даже если внешнее API вернуло ошибку (например 401) — удаляем локально
      mainStore.removeFromHistory(kp_id)
      emit('item-deleted', kp_id)
      if (code === 401) {
        console.warn('401 from external API — removed locally')
      }
    }
  } else {
    mainStore.removeFromHistory(kp_id)
    emit('item-deleted', kp_id)
  }
}

// Карточки этого списка в порядке показа. Берём из разметки, а не из
// сохранённых ссылок: те копятся при смене списка и перестают совпадать.
const listCards = () => [...(gridRef.value?.querySelectorAll('.movie-card') || [])]

// Сколько карточек в ряду — по фактическому положению на экране. Разбор
// grid-template-columns на старых браузерах телевизоров врёт.
const countColumns = (cards) => {
  const top = cards[0]?.getBoundingClientRect().top
  const index = cards.findIndex((card) => Math.abs(card.getBoundingClientRect().top - top) > 4)
  return index === -1 ? cards.length || 1 : index
}

const focusCard = (card) => {
  if (!card) return
  card.focus({ preventScroll: true })
  card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
}

const handleKeyDown = (event) => {
  // Стрелку уже обработали (например, «вниз» из строки поиска перевело фокус
  // на первую карточку) — второй раз сдвигать нельзя, иначе проскакиваем ряд.
  if (event.defaultPrevented || !moviesList?.length) return

  // На странице бывает несколько списков, и каждый слушает клавиши.
  // Отвечает только тот, в котором стоит фокус — иначе пульт телевизора
  // перебрасывал фокус в соседний список «на строчку ниже».
  const cards = listCards()
  const currentIndex = cards.indexOf(document.activeElement)
  if (currentIndex === -1) return

  const columns = countColumns(cards)
  const column = currentIndex % columns
  let target = null

  switch (event.key) {
    case 'ArrowRight':
      event.preventDefault()
      // С последней карточки ряда никуда не прыгаем: раньше фокус уезжал
      // в начало следующего ряда, и с пульта это выглядело как «вниз».
      if (column < columns - 1) target = cards[currentIndex + 1]
      break
    case 'ArrowLeft': {
      event.preventDefault()
      // С крайней левой карточки ряда — в боковую панель.
      if (column === 0) {
        const sidebarItem =
          document.querySelector('.sidebar .nav-item.router-link-active') ||
          document.querySelector('.sidebar .nav-item')
        if (sidebarItem && sidebarItem.offsetParent !== null) sidebarItem.focus()
        break
      }
      target = cards[currentIndex - 1]
      break
    }
    case 'ArrowUp':
      event.preventDefault()
      if (currentIndex < columns) {
        const searchInput = document.querySelector('.search-input')
        if (searchInput) searchInput.focus()
      } else {
        target = cards[currentIndex - columns]
      }
      break
    case 'ArrowDown':
      event.preventDefault()
      // В неполном последнем ряду — на последнюю карточку
      if (currentIndex + columns < cards.length) target = cards[currentIndex + columns]
      else if (Math.floor(currentIndex / columns) < Math.floor((cards.length - 1) / columns)) target = cards[cards.length - 1]
      break
    case 'Home':
      target = cards[0]
      break
    case 'End':
      target = cards[cards.length - 1]
      break
    case 'Enter':
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        window.open(movieUrl(moviesList[currentIndex]), '_blank')
      } else {
        router.push(getMovieSeoPath(moviesList[currentIndex]))
      }
      break
  }

  if (target) {
    activeMovieIndex.value = cards.indexOf(target)
    focusCard(target)
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
})
</script>

<style scoped>
.grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
  justify-content: start;
  margin: 0;
  width: 100%;
  padding: 0;
  box-sizing: border-box;
  position: relative;
  min-height: 200px;
}

.grid.card-size-small {
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
}

.grid.card-size-medium {
  grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
  gap: 14px;
}

.grid.card-size-large {
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.grid.variant-related {
  min-height: 0;
}

@media (max-width: 620px) {
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 10px;
  }
}
</style>
