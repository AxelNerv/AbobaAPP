<template>
  <div class="movie-details" :class="`variant-${variant}`">
    <div class="movie-header">
      <h3>{{ removeYearFromTitle(movie.title) }}</h3>
    </div>

    <div v-if="movie.raw_data?.name_en || movie.raw_data?.Name_original" class="original-title">
      {{ movie.raw_data.name_en || movie.raw_data.Name_original }}
    </div>

    <!-- Вместо старого места для типа выводим год выпуска -->
    <div v-if="movie.year" class="meta">
      <span class="year">{{ movie.year }}</span>
    </div>

    <div v-if="movie.raw_data?.genres?.length" class="genres">
      <template v-for="genre in movie.raw_data.genres.slice(0, 2)" :key="genre.genre">
        <span class="genre-tag">{{ genre.genre }}</span>
      </template>
      <span v-if="movie.raw_data.genres.length > 2" class="genre-count">
        +{{ movie.raw_data.genres.length - 2 }}
      </span>
    </div>
  </div>
</template>

<script setup>
const { movie, variant = 'default' } = defineProps({
  movie: Object,
  isHistory: Boolean,
  variant: String
})

const removeYearFromTitle = (title) => {
  return title ? title.replace(/\(\d{4}\)$/, '').trim() : title
}
</script>

<style scoped>
.movie-details {
  --movie-details-padding: 9px 10px 10px;
  --movie-details-gap: 0;
  --movie-details-bg: transparent;
  --movie-title-color: #fff;
  --movie-title-clamp: 2;
  --movie-title-max-height: 2.6em;
  --movie-year-color: rgba(255,255,255,0.25);
  --movie-genre-color: rgba(255,255,255,0.35);
  --movie-genre-bg: rgba(255,255,255,0.05);
  --movie-genre-border: transparent;
  padding: var(--movie-details-padding);
  min-width: 0;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: var(--movie-details-gap);
  background: var(--movie-details-bg);
}

.movie-details.variant-related {
  --movie-details-padding: 9px 10px 10px;
  --movie-details-gap: 2px;
  --movie-title-clamp: 2;
  --movie-title-max-height: 2.4em;
  position: relative;
  min-height: 60px;
}

.movie-header {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 3px;
}

.movie-header h3 {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: var(--movie-title-clamp);
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
  max-height: var(--movie-title-max-height);
  word-break: break-word;
  color: var(--movie-title-color);
}

.movie-details.variant-related .movie-header {
  margin-bottom: 0;
}

.original-title {
  font-size: 11px;
  color: rgba(255,255,255,0.32);
  margin-bottom: 3px;
  font-style: normal;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.movie-details.variant-related .original-title {
  display: none;
}

.year {
  font-size: 11px;
  color: var(--movie-year-color);
}

.meta {
  margin-bottom: 3px;
}

.movie-details.variant-related .meta {
  margin-bottom: 0;
}

.genres {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
  align-items: center;
}

.movie-details.variant-related .genres {
  gap: 4px;
  margin-top: auto;
}

.genre-tag {
  font-size: 0.75em;
  color: var(--movie-genre-color);
  background-color: var(--movie-genre-bg);
  border: 1px solid var(--movie-genre-border);
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
}

.genre-count {
  font-size: 0.75em;
  color: var(--movie-genre-color);
  background-color: var(--movie-genre-bg);
  border: 1px solid var(--movie-genre-border);
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
}

@media (max-width: 600px) {
  .movie-details {
    padding: 8px;
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .movie-details.variant-related {
    --movie-details-padding: 8px 8px 10px;
    min-height: 58px;
  }

  .movie-header {
    margin-bottom: 6px;
  }

  .movie-header h3 {
    font-size: 0.95em;
    -webkit-line-clamp: 4;
    -moz-line-clamp: 4;
    line-clamp: 4;
    max-height: 4.8em;
    line-height: 1.2;
    word-wrap: break-word;
    word-break: break-word;
    hyphens: auto;
  }

  .original-title {
    margin-bottom: 6px;
    font-size: 0.75em;
  }

  .meta {
    margin-bottom: 6px;
  }

  .year {
    font-size: 0.9em;
  }

  .genres {
    margin-top: 3px;
  }

  .genre-tag,
  .genre-count {
    font-size: 0.7em;
    padding: 1px 4px;
  }
}
</style>
