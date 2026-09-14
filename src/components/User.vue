<template>
  <div class="profile-page">
    <h2 class="section-title"><span class="bar"></span>Профиль</h2>

    <div v-if="user" class="profile-top">
      <div class="avatar-wrap">
        <img v-if="user.photo && photoURL" :src="photoURL" alt="avatar" class="avatar-img" />
        <div v-else class="avatar-placeholder">
          {{ (user.name || '?').charAt(0).toUpperCase() }}
        </div>
      </div>

      <div class="name-line">
        Name:
        <span v-if="!isEditingName" class="name-text" @click="startEditName">
          <b>{{ user.name }}</b>
          <AppIcon name="edit" :size="14" class="edit-icon" />
        </span>
        <span v-else class="name-edit">
          <input
            ref="nameInput"
            v-model="editingName"
            class="name-input"
            maxlength="50"
            @keyup.enter="saveName"
            @keyup.esc="cancelEditName"
            @blur="saveName"
          />
        </span>
      </div>

      <button class="logout-btn" @click="confirmLogout">Выйти</button>
    </div>

    <div v-else class="loading">Загрузка профиля...</div>

    <div v-if="user" class="history-section">
      <div class="history-header">
        <span>История просмотра</span>
        <span class="history-count">{{ history.length }} фильмов</span>
      </div>
      <div class="history-body">
        <div v-if="!history.length" class="history-empty">
          Сама история просмотра
        </div>
        <div
          v-else
          ref="historyScrollerRef"
          class="history-scroller"
          @mousedown="onDragStart($event, 'history')"
        >
          <div class="history-row">
            <div
              v-for="item in history"
              :key="item.kp_id"
              class="h-card"
              @click="openMovie(item)"
            >
              <div class="h-poster">
                <img
                  v-if="item.poster || item.cover"
                  :src="item.poster || item.cover"
                  :alt="item.title"
                  @error="onPosterError($event)"
                />
                <div v-else class="h-poster-fallback">
                  {{ item.title || 'Без названия' }}
                </div>
              </div>
              <div class="h-info">
                <div class="h-title">{{ item.title || item.name_ru }}</div>
                <div class="h-year">{{ item.year }}</div>
              </div>
              <button
                class="h-remove"
                title="Удалить из истории"
                @click.stop="removeFromHistoryItem(item)"
              >✕</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Избранное — 2 ряда, drag-скролл -->
    <div v-if="user && favorites.length" class="history-section favorites-section">
      <div class="history-header">
        <span>Избранное</span>
        <span class="history-count">{{ favorites.length }} фильмов</span>
      </div>
      <div class="history-body">
        <div
          ref="favScrollerRef"
          class="history-scroller"
          @mousedown="onDragStart($event, 'favorites')"
        >
          <!-- Разбиваем на 2 ряда: чётные и нечётные индексы -->
          <div class="fav-grid">
            <div class="history-row">
              <div
                v-for="item in favRow1"
                :key="item.kp_id"
                class="h-card"
                @click="openMovie(item)"
              >
                <div class="h-poster">
                  <img
                    v-if="item.poster || item.cover"
                    :src="item.poster || item.cover"
                    :alt="item.title"
                    @error="onPosterError($event)"
                  />
                  <div v-else class="h-poster-fallback">
                    {{ item.title || 'Без названия' }}
                  </div>
                </div>
                <div class="h-info">
                  <div class="h-title">{{ item.title || item.name_ru }}</div>
                  <div class="h-year">{{ item.year }}</div>
                </div>
                <button
                  class="h-remove"
                  title="Убрать из избранного"
                  @click.stop="removeFromFav(item)"
                >✕</button>
              </div>
            </div>
            <div class="history-row">
              <div
                v-for="item in favRow2"
                :key="item.kp_id"
                class="h-card"
                @click="openMovie(item)"
              >
                <div class="h-poster">
                  <img
                    v-if="item.poster || item.cover"
                    :src="item.poster || item.cover"
                    :alt="item.title"
                    @error="onPosterError($event)"
                  />
                  <div v-else class="h-poster-fallback">
                    {{ item.title || 'Без названия' }}
                  </div>
                </div>
                <div class="h-info">
                  <div class="h-title">{{ item.title || item.name_ru }}</div>
                  <div class="h-year">{{ item.year }}</div>
                </div>
                <button
                  class="h-remove"
                  title="Убрать из избранного"
                  @click.stop="removeFromFav(item)"
                >✕</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showDialog" class="dialog-overlay" @click="showDialog = false">
      <div class="dialog" @click.stop>
        <h3>Выход</h3>
        <p>Вы уверены?</p>
        <div class="dialog-actions">
          <button class="btn-cancel" @click="showDialog = false">Отмена</button>
          <button class="btn-danger" @click="logout">Выйти</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, nextTick } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useAuthStore } from '@/store/auth'
import { useMainStore } from '@/store/main'
import { useFavoritesStore } from '@/store/favorites'
import { useRouter } from 'vue-router'
import { getBaseURL } from '@/api/axios'
import { getMovieSeoPath } from '@/utils/movieSeo'
import { delFromList } from '@/api/user'
import { USER_LIST_TYPES_ENUM } from '@/constants'


export default {
  name: 'ProfilePage',
  components: { AppIcon },
  setup() {
    const showDialog = ref(false)
    const authStore = useAuthStore()
    const mainStore = useMainStore()
    const favoritesStore = useFavoritesStore()
    const router = useRouter()
    const user = ref(authStore.user)
    const photoURL = ref(null)
    const isEditingName = ref(false)
    const editingName = ref('')
    const nameInput = ref(null)
    const historyScrollerRef = ref(null)
    const favScrollerRef = ref(null)

    const history = computed(() => mainStore.history || [])
    const favorites = computed(() => favoritesStore.favorites || [])

    // Разбиваем избранное на 2 ряда: нечётные индексы → ряд 1, чётные → ряд 2
    const favRow1 = computed(() => favorites.value.filter((_, i) => i % 2 === 0))
    const favRow2 = computed(() => favorites.value.filter((_, i) => i % 2 === 1))

    const openMovie = (item) => {
      router.push(getMovieSeoPath({ kp_id: item.kp_id, slug: item.slug }))
    }

    const removeFromHistoryItem = async (item) => {
      // Удаляем локально сразу — UI отзывчивый
      mainStore.removeFromHistory(item.kp_id)
      // Удаляем на сервере тихо (не блокируем UI если сервер недоступен)
      try {
        await delFromList(item.kp_id, USER_LIST_TYPES_ENUM.HISTORY)
      } catch (e) {
        console.warn('[history] server delete failed:', e?.message || e)
      }
    }

    const removeFromFav = (item) => {
      favoritesStore.remove(item.kp_id)
    }

    const onPosterError = (e) => {
      e.target.style.display = 'none'
    }

    // ── Drag-скролл (зажать ЛКМ и двигать) ──────────────────────────
    let dragState = null

    const onDragStart = (e, type) => {
      const el = type === 'history' ? historyScrollerRef.value : favScrollerRef.value
      if (!el) return
      dragState = { el, startX: e.pageX, scrollLeft: el.scrollLeft, dragging: false }

      const onMove = (ev) => {
        if (!dragState) return
        const dx = ev.pageX - dragState.startX
        if (Math.abs(dx) > 4) dragState.dragging = true
        if (dragState.dragging) {
          el.scrollLeft = dragState.scrollLeft - dx
          el.style.cursor = 'grabbing'
          ev.preventDefault()
        }
      }
      const onUp = () => {
        if (dragState) el.style.cursor = 'grab'
        dragState = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }

    const loadPhoto = async () => {
      if (user.value?.photo) {
        try {
          const baseURL = await getBaseURL()
          photoURL.value = `${baseURL}${user.value.photo}`
        } catch { photoURL.value = null }
      }
    }

    const startEditName = () => {
      editingName.value = user.value?.name || ''
      isEditingName.value = true
      nextTick(() => nameInput.value?.focus())
    }
    const cancelEditName = () => { isEditingName.value = false }
    const saveName = async () => {
      if (!isEditingName.value) return
      const newName = editingName.value.trim()
      if (newName && newName !== user.value.name) {
        try {
          await authStore.updateUserName(newName)
          user.value = { ...user.value, name: newName }
        } catch { /* ignore */ }
      }
      isEditingName.value = false
    }

    const confirmLogout = () => { showDialog.value = true }
    const logout = () => {
      authStore.logout()
      showDialog.value = false
      router.push('/login')
    }

    onMounted(() => {
      loadPhoto()
      favoritesStore.loadFromServer()
    })

    return {
      user, photoURL,
      isEditingName, editingName, nameInput,
      history, favorites, favRow1, favRow2,
      historyScrollerRef, favScrollerRef,
      openMovie, removeFromHistoryItem, removeFromFav, onPosterError, onDragStart,
      startEditName, cancelEditName, saveName,
      confirmLogout, showDialog, logout
    }
  }
}
</script>

<style scoped>
.profile-page {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px 28px 60px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fff;
  justify-content: center;
}
.bar {
  display: inline-block;
  width: 3px; height: 15px;
  background: linear-gradient(180deg, var(--accent-color), var(--accent2));
  border-radius: 2px;
}

.profile-top {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-bottom: 32px;
}

.avatar-wrap { width: 80px; height: 80px; }
.avatar-img, .avatar-placeholder {
  width: 80px; height: 80px;
  border-radius: 50%;
  background: rgba(255,255,255,0.08);
  border: 2px solid rgba(255,255,255,0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: 700;
  color: rgba(255,255,255,0.7);
  object-fit: cover;
}

.name-line {
  font-size: 14px;
  color: rgba(255,255,255,0.45);
  display: flex;
  align-items: center;
  gap: 6px;
}
.name-text {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #fff;
}
.edit-icon { font-size: 11px; opacity: 0.4; margin-left: 4px; }
.name-text:hover .edit-icon { opacity: 1; }
.name-input {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(0,229,255,0.3);
  border-radius: 6px;
  padding: 3px 8px;
  color: #fff;
  font-size: 13px;
  outline: none;
}

.info-pill {
  padding: 9px 20px;
  border-radius: 9px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}
.pill-label { color: rgba(255,255,255,0.38); }
.sub-active  { color: var(--accent-color); }
.sub-inactive { color: rgba(255,90,90,0.9); }

/* Плашка роли */
.status-pill b { font-weight: 700; }

.status-pill.status-admin {
  border-color: rgba(255, 82, 82, 0.5);
  background: rgba(255, 50, 50, 0.1);
  box-shadow: 0 0 0 1px rgba(255, 82, 82, 0.15) inset;
}
.status-pill.status-admin b { color: #ff6b6b; }

.status-pill.status-moderator {
  border-color: rgba(100, 150, 255, 0.5);
  background: rgba(90, 140, 255, 0.1);
  box-shadow: 0 0 0 1px rgba(100, 150, 255, 0.15) inset;
}
.status-pill.status-moderator b { color: #6aa1ff; }
.pill-sep    { color: rgba(255,255,255,0.2); }
.pill-detail { color: rgba(255,255,255,0.38); }
.limit-text  { color: rgba(255,220,80,0.9); font-weight: 600; }
.limit-hint  {
  color: rgba(255,255,255,0.3);
  font-size: 11px;
  display: block;
  width: 100%;
  text-align: center;
}

.logout-btn {
  padding: 10px 32px;
  border-radius: 10px;
  border: 1px solid rgba(0,229,255,0.3);
  background: rgba(0,229,255,0.07);
  color: var(--accent-color);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  margin-top: 4px;
  transition: background 0.15s;
}
.logout-btn:hover { background: rgba(0,229,255,0.15); }

.history-section {
  border: 1px solid rgba(0,229,255,0.2);
  border-radius: 12px;
  overflow: hidden;
  background: rgba(10,12,24,0.5);
}
.history-header {
  padding: 13px 18px;
  background: rgba(0,229,255,0.04);
  border-bottom: 1px solid rgba(0,229,255,0.1);
  font-size: 14px;
  font-weight: 600;
  color: rgba(255,255,255,0.7);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.history-count { font-size: 11px; color: rgba(255,255,255,0.3); font-weight: 400; }
.history-body { padding: 14px; min-height: 140px; }
.history-empty {
  text-align: center;
  padding: 28px 0;
  color: rgba(255,255,255,0.28);
  font-size: 14px;
}

.history-scroller {
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 8px;
  cursor: grab;
  user-select: none;
}
.history-scroller:active { cursor: grabbing; }
.history-scroller::-webkit-scrollbar { height: 6px; }
.history-scroller::-webkit-scrollbar-thumb {
  background: rgba(0,229,255,0.25);
  border-radius: 3px;
}
.history-row { display: flex; gap: 10px; min-width: max-content; }

/* Избранное — 2 ряда */
.favorites-section { margin-top: 16px; }
.fav-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.h-card {
  flex: 0 0 140px;
  width: 140px;
  cursor: pointer;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255,255,255,0.04);
  transition: transform 0.2s, box-shadow 0.2s;
  position: relative;
}
.h-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 28px rgba(0,0,0,0.45);
}
.h-poster {
  width: 100%;
  aspect-ratio: 2/3;
  background: linear-gradient(160deg, #1a0a1a, #3d1535);
  position: relative;
  overflow: hidden;
}
.h-poster img { width: 100%; height: 100%; object-fit: cover; }
.h-poster-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  padding: 8px;
  font-size: 11px;
  font-weight: 700;
  color: rgba(255,255,255,0.55);
  line-height: 1.3;
}
.h-info { padding: 8px 10px 10px; }
.h-title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.h-year { font-size: 11px; color: rgba(255,255,255,0.28); margin-top: 2px; }

.h-remove {
  position: absolute;
  top: 6px; right: 6px;
  width: 22px; height: 22px;
  border-radius: 50%;
  background: rgba(0,0,0,0.7);
  border: 1px solid rgba(255,90,90,0.4);
  color: #ff5e8a;
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.h-card:hover .h-remove { opacity: 1; }
.h-remove:hover { background: rgba(255,90,90,0.2); }

.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(6px);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog {
  background: #0f1420;
  border: 1px solid rgba(0,229,255,0.2);
  border-radius: 12px;
  padding: 24px;
  min-width: 320px;
  text-align: center;
}
.dialog h3 { margin: 0 0 10px; color: #fff; }
.dialog p { color: rgba(255,255,255,0.55); margin: 0 0 20px; }
.dialog-actions { display: flex; justify-content: center; gap: 10px; }
.btn-cancel, .btn-danger {
  padding: 8px 20px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.05);
  color: #fff;
}
.btn-danger {
  border-color: rgba(255,90,90,0.5);
  background: rgba(255,90,90,0.15);
  color: #ff5e8a;
}
.btn-danger:hover { background: rgba(255,90,90,0.28); }

.loading { text-align: center; padding: 30px; color: rgba(255,255,255,0.5); }
</style>
