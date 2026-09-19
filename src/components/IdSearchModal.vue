<template>
  <div class="id-search-overlay" @click="closeModal">
    <div class="id-search-modal" @click.stop>
      <button class="close-btn" aria-label="Закрыть" @click="closeModal">
        <AppIcon name="close" :size="16" />
      </button>

      <h2 class="modal-title">
        <AppIcon name="fingerprint" :size="16" /> Поиск по ID
      </h2>

      <!-- Вкладки типа поиска -->
      <div class="search-tabs">
        <button
          :class="{ active: searchType === 'kinopoisk' }"
          @click="setSearchType('kinopoisk')"
        >
          ID Кинопоиск
        </button>
        <button
          :class="{ active: searchType === 'imdb' }"
          @click="setSearchType('imdb')"
        >
          ID IMDB
        </button>
      </div>

      <!-- Поле ввода -->
      <div class="input-wrapper">
        <input
          ref="searchInput"
          v-model="searchTerm"
          :placeholder="getPlaceholder()"
          class="search-input"
          inputmode="numeric"
          @keydown.enter.prevent="search"
          @keydown.esc="closeModal"
        />
        <div class="input-icons">
          <button v-if="searchTerm" class="reset-btn" @click="searchTerm = ''">
            <AppIcon name="close" :size="16" />
          </button>
          <button class="search-btn" @click="search">
            <AppIcon name="search" :size="16" />
          </button>
        </div>
      </div>

      <!-- Ошибка -->
      <div v-if="errorMessage" class="error-msg">
        <AppIcon name="error" :size="16" /> {{ errorMessage }}
      </div>

      <!-- Результаты -->
      <div v-if="loading" class="loading-state">
        <AppIcon name="loading" :size="15" class="spin" /> Поиск...
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useRouter } from 'vue-router'
import { useNavbarStore } from '@/store/navbar'
import { getKpIDfromIMDB } from '@/api/movies'
import { getMovieSeoPath } from '@/utils/movieSeo'

const navbarStore = useNavbarStore()
const router = useRouter()

const searchTerm = ref('')
const searchType = ref('kinopoisk')
const errorMessage = ref('')
const loading = ref(false)
const searchInput = ref(null)

const closeModal = () => navbarStore.closeIdSearchModal()

const setSearchType = (type) => {
  searchType.value = type
  searchTerm.value = ''
  errorMessage.value = ''
}

const getPlaceholder = () => ({
  kinopoisk: 'Введите ID Кинопоиска (например: 326)',
  imdb: 'Введите ID IMDB (например: tt0111161)'
})[searchType.value] || 'Введите ID'

const search = async () => {
  if (!searchTerm.value.trim()) return
  errorMessage.value = ''
  loading.value = true

  try {
    if (searchType.value === 'kinopoisk') {
      closeModal()
      router.push(getMovieSeoPath({ kp_id: searchTerm.value.trim() }))
    } else if (searchType.value === 'imdb') {
      const response = await getKpIDfromIMDB(searchTerm.value)
      if (response?.id_kp) {
        closeModal()
        router.push(getMovieSeoPath({ kp_id: `${response.id_kp}` }))
      } else {
        errorMessage.value = 'Не удалось найти фильм по IMDB ID'
      }
    }
  } catch (error) {
    errorMessage.value = 'Ошибка при поиске. Проверьте ID и попробуйте снова.'
    console.warn('[id-search] поиск не удался:', error?.message || error)
  } finally {
    loading.value = false
  }
}

const handleKeydown = (e) => {
  if (e.key === 'Escape') closeModal()
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  nextTick(() => searchInput.value?.focus())
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<style lang="scss" scoped>
.id-search-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 100;
}

.id-search-modal {
  position: relative;
  background: rgba(10, 12, 24, 0.97);
  border: 1px solid rgba(var(--accent-rgb), 0.22);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6),
              0 0 40px rgba(var(--accent-rgb), 0.08);
  border-radius: 14px;
  padding: 28px 26px 24px;
  width: 100%;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 18px;

  @media (max-width: 600px) {
    max-width: 95vw;
    padding: 22px 16px 18px;
  }
}

.close-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  cursor: pointer;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  transition: all 0.18s;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    color: #fff;
    border-color: rgba(var(--accent-rgb), 0.35);
    background: rgba(var(--accent-rgb), 0.08);
  }
}

.modal-title {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;

  i {
    color: var(--accent-color);
    font-size: 16px;
  }
}

.search-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  button {
    padding: 7px 14px;
    font-size: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.03);
    color: rgba(255, 255, 255, 0.65);
    border-radius: 7px;
    cursor: pointer;
    transition: all 0.18s;
    font-weight: 500;

    &:hover {
      border-color: rgba(var(--accent-rgb), 0.35);
      color: #fff;
    }

    &.active {
      border-color: rgba(var(--accent-rgb), 0.6);
      color: var(--accent-color);
      background: rgba(var(--accent-rgb), 0.08);
    }
  }
}

.input-wrapper {
  position: relative;
}

.search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 11px 78px 11px 14px;
  font-size: 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: #fff;
  outline: none;
  transition: all 0.2s;

  &::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  &:focus {
    border-color: rgba(var(--accent-rgb), 0.5);
    background: rgba(var(--accent-rgb), 0.04);
    box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1);
  }
}

.input-icons {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 2px;

  button {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    padding: 6px 8px;
    border-radius: 5px;
    transition: all 0.15s;
    font-size: 13px;

    &:hover {
      color: var(--accent-color);
      background: rgba(var(--accent-rgb), 0.08);
    }
  }

  .search-btn {
    font-size: 14px;
  }
}

.error-msg {
  color: #ff7588;
  background: rgba(255, 82, 82, 0.08);
  border: 1px solid rgba(255, 82, 82, 0.2);
  padding: 8px 12px;
  border-radius: 7px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.loading-state {
  color: rgba(255, 255, 255, 0.45);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
