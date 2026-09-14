<template>
  <div class="page">
    <div class="topbar">
      <h2 class="section-title">
        <span class="bar"></span>
        История просмотра
        <button v-if="history.length" class="clear-btn" title="Очистить историю" @click="clearAll">
          <AppIcon name="delete" :size="16" />
        </button>
      </h2>
    </div>

    <div v-if="!history.length" class="empty">
      Здесь пока пусто — начните смотреть фильм
    </div>

    <MovieList v-else :movies-list="historyMovies" :loading="false" :is-history="true" variant="default" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useMainStore } from '@/store/main'
import { MovieList } from '@/components/MovieList'

const mainStore = useMainStore()

const history = computed(() => mainStore.history || [])
const historyMovies = computed(() =>
  history.value.map((m) => ({
    id: m.kp_id,
    kp_id: m.kp_id,
    title: m.title,
    name_ru: m.title,
    slug: m.slug,
    year: m.year,
    type: m.type,
    poster: m.poster,
    rating_kp: m.rating_kp,
    rating_imdb: m.rating_imdb
  }))
)

const clearAll = () => {
  if (confirm('Очистить всю историю?')) {
    mainStore.setHistory([])
  }
}
</script>

<style scoped>
.page {
  padding: 0 28px 40px;
  max-width: calc(100vw - 60px);
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  padding: 16px 0 12px;
  background: linear-gradient(to bottom, var(--bg-primary) 60%, transparent);
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 8px;
}

.bar {
  display: inline-block;
  width: 3px; height: 15px;
  background: linear-gradient(180deg, var(--accent-color), var(--accent2));
  border-radius: 2px;
}

.clear-btn {
  margin-left: auto;
  background: transparent;
  border: 1px solid rgba(255,82,82,0.25);
  color: #ff5252;
  border-radius: 7px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;

  &:hover {
    background: rgba(255,82,82,0.1);
  }
}

.empty {
  text-align: center;
  padding: 40px 20px;
  color: rgba(255,255,255,0.28);
  font-size: 14px;
}
</style>
