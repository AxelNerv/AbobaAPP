<template>
  <div>
    <div
      v-show="!loading"
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
            @save:element="(el) => (movieRefs[index] = el)"
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
          @save:element="(el) => (movieRefs[index] = el)"
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
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

const movieRefs = ref([])
const activeMovieIndex = ref(null)

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

const handleKeyDown = (event) => {
  // Стрелку уже обработали (например, «вниз» из строки поиска перевело фокус
  // на первую карточку) — второй раз сдвигать нельзя, иначе проскакиваем ряд.
  if (event.defaultPrevented || !moviesList?.length) return

  const focusedCard =
    event.target?.classList?.contains('movie-card') ? event.target : document.activeElement

  if (!focusedCard?.classList?.contains('movie-card')) {
    return
  }

  const focusedIndex = movieRefs.value.findIndex((element) => element === focusedCard)
  const currentIndex = activeMovieIndex.value ?? (focusedIndex >= 0 ? focusedIndex : 0)

  const grid = document.querySelector('.grid')
  const gridStyle = window.getComputedStyle(grid)
  const columns = gridStyle.gridTemplateColumns.split(' ').length

  switch (event.key) {
    case 'ArrowRight':
      activeMovieIndex.value = (currentIndex + 1) % moviesList.length
      break
    case 'ArrowLeft': {
      // С крайней левой карточки ряда — в боковую панель. Раньше фокус
      // перескакивал в конец предыдущего ряда, и с пульта телевизора
      // до панели было не добраться: список просто листался.
      const sidebarItem =
        document.querySelector('.sidebar .nav-item.router-link-active') ||
        document.querySelector('.sidebar .nav-item')
      if (currentIndex % columns === 0 && sidebarItem && sidebarItem.offsetParent !== null) {
        event.preventDefault()
        sidebarItem.focus()
        break
      }
      activeMovieIndex.value = Math.max(currentIndex - 1, 0)
      break
    }
    case 'ArrowUp':
      event.preventDefault()
      if (currentIndex <= 0) {
        const searchInput = document.querySelector('.search-input')
        if (searchInput) {
          searchInput.focus()
        }
      } else {
        activeMovieIndex.value = Math.max(currentIndex - columns, 0)
      }
      break
    case 'ArrowDown':
      event.preventDefault()
      activeMovieIndex.value = Math.min(currentIndex + columns, moviesList.length - 1)
      break
    case 'Home':
      activeMovieIndex.value = 0
      break
    case 'End':
      activeMovieIndex.value = moviesList.length - 1
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
}

watch(activeMovieIndex, (newIndex) => {
  if (movieRefs.value[newIndex]) {
    movieRefs.value[newIndex].scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center'
    })
    movieRefs.value[newIndex].focus()
  }
})

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
