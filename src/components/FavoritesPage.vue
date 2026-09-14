<template>
  <div class="page">
    <div class="topbar">
      <h2 class="section-title">
        <span class="bar"></span>
        Избранное
      </h2>
    </div>

    <div v-if="!favorites.length" class="empty">
      Здесь пока пусто — добавьте фильм в избранное со страницы фильма
    </div>

    <MovieList v-else :movies-list="movies" :loading="false" variant="default" />
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useFavoritesStore } from '@/store/favorites'
import { MovieList } from '@/components/MovieList'

const favoritesStore = useFavoritesStore()
const favorites = computed(() => favoritesStore.favorites || [])

onMounted(() => {
  favoritesStore._load()
})

const movies = computed(() =>
  favorites.value.map((m) => ({
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
</script>

<style scoped>
.page {
  padding: 0 28px 40px;
  max-width: 100%;
  box-sizing: border-box;
}

@media (max-width: 768px) {
  .page {
    padding: 0 12px 30px;
  }
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  padding: 16px 0 12px;
  background: linear-gradient(to bottom, var(--bg-primary) 60%, transparent);
}

@media (max-width: 768px) {
  .topbar {
    top: 60px; /* MobileHeader height — чтобы topbar не уходил под него */
  }
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

.empty {
  text-align: center;
  padding: 40px 20px;
  color: rgba(255,255,255,0.28);
  font-size: 14px;
}
</style>
