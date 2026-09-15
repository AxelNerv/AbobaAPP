<template>
  <div class="login-page">
    <h1 class="login-title">Вход через Telegram</h1>

    <div class="login-card">
      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <p>Загрузка данных...</p>
      </div>

      <template v-else>
        <p class="login-desc">
          Нажмите кнопку — откроется бот.<br />
          Подтвердите вход и страница обновится автоматически.
        </p>

        <button class="tg-btn" @click="loginWithTelegram">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="tg-icon">
            <path
              d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.32 14.26l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.828.299z"
              fill="currentColor"
            />
          </svg>
          Войти через Telegram
        </button>

        <div class="divider">
          <span>или</span>
        </div>

        <button class="qr-btn" @click="showQRModal">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" class="qr-icon">
            <path
              fill="currentColor"
              d="M0 224h192V32H0v192zM64 96h64v64H64V96zm192-64v192h192V32H256zm128 128h-64V96h64v64zM0 480h192V288H0v192zm64-128h64v64H64v-64zm352-64h32v32h-32v-32zm0 64h32v32h-32v-32zm0 64h32v32h-32v-32zm-64-64h32v32h-32v-32zm0 64h32v32h-32v-32zm0 64h32v32h-32v-32zm-64-192h32v32h-32v-32zm0 64h32v32h-32v-32zm0 64h32v32h-32v-32zm0 64h32v32h-32v-32zm64-256h32v32h-32v-32zm0 64h32v32h-32v-32zm64-64h32v32h-32v-32z"
            />
          </svg>
          Войти через QR-код
        </button>
      </template>

      <div v-if="error" class="error-message">{{ error }}</div>
      <button v-if="error && !loading" class="qr-btn" @click="initAuth">Попробовать ещё раз</button>
    </div>

    <!-- QR Модалка -->
    <div v-if="showModal" class="modal-overlay" @click="closeModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>Вход через QR-код</h3>
          <button class="close-btn" @click="closeModal">&times;</button>
        </div>
        <div class="modal-body">
          <p class="qr-hint">Отсканируйте QR-код с телефона</p>
          <div class="qr-bg">
            <qrcode-vue v-if="!error" :value="qrValue" :size="qrSize" level="H" class="qr-code" />
            <div v-else class="error-placeholder">Ошибка загрузки QR-кода</div>
          </div>
          <p class="qr-hint">
            Используйте Telegram или любое приложение для сканирования QR-кода
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted } from 'vue'
import QrcodeVue from 'qrcode.vue'
import { generateToken, getTGAuthResult, syncNow } from '@/api/user'
import { useAuthStore } from '@/store/auth'
import { useRouter } from 'vue-router'

export default {
  components: { QrcodeVue },
  setup() {
    const qrValue = ref('')
    const authValue = ref('')
    const qrSize = ref(250)
    const loading = ref(true)
    const error = ref(null)
    const popup = ref(null)
    const showModal = ref(false)
    const authStore = useAuthStore()
    const router = useRouter()
    let pollTimer = null
    let disposed = false
    let generation = 0

    const initAuth = async () => {
      clearTimeout(pollTimer)
      const attempt = ++generation
      loading.value = true
      error.value = null
      try {
        const generateTokenResponse = await generateToken()
        if (disposed || attempt !== generation) return
        const token = generateTokenResponse.token
        const authURL = generateTokenResponse.telegram_link
        qrValue.value = authURL
        authValue.value = authURL
        loading.value = false

        const deadline = Date.now() + 5 * 60 * 1000
        const poll = async () => {
          if (disposed || attempt !== generation) return
          if (Date.now() > deadline) { error.value = 'Код истёк. Начните вход заново.'; return }
          let response
          try {
            response = await getTGAuthResult(token)
          } catch (err) {
            if (!disposed && attempt === generation) error.value = err.message
            return
          }
          if (disposed || attempt !== generation) return
          if (response.authenticated && response.token) {
            if (popup.value) {
              popup.value.close()
              popup.value = null
            }
            // Сохраняем юзера локально из данных бэкенда (не дёргаем rhserv.vu)
            authStore.setToken(response.token)
            if (response.user) {
              authStore.setUser({
                id: response.user.tg_id,
                name: response.user.name || response.user.first_name || 'User',
                username: response.user.username || '',
                photo: response.user.photo_url || ''
              })
            }
            // Библиотека живёт на сервере входа: даём ей подтянуться до перехода,
            // иначе первая страница покажет пустую историю. Не дольше 10 секунд —
            // без сети приложение всё равно работает, синхронизация дойдёт позже.
            await Promise.race([
              syncNow().catch(() => null),
              new Promise((resolve) => setTimeout(resolve, 10000))
            ])
            // Редирект на главную без AuthSuccess (он дёргает чужое API)
            router.push('/').then(() => router.go(0))
            return
          }
          pollTimer = setTimeout(poll, 2000)
        }
        pollTimer = setTimeout(poll, 2000)
      } catch (err) {
        if (disposed || attempt !== generation) return
        error.value = err.message || 'Не удалось получить данные для входа.'
        loading.value = false
        console.error('Ошибка при инициализации аутентификации:', err)
      }
    }

    function loginWithTelegram() {
      if (authValue.value) {
        popup.value = window.open(authValue.value, 'tg_open')
        setTimeout(() => {
          if (popup.value) {
            popup.value.close()
            popup.value = null
          }
        }, 3000)
      } else {
        error.value = 'URL для входа не доступен'
      }
    }

    function showQRModal() {
      showModal.value = true
    }
    function closeModal() {
      showModal.value = false
    }

    onMounted(async () => { await initAuth() })
    onUnmounted(() => { disposed = true; clearTimeout(pollTimer) })

    return {
      qrValue, qrSize, loading, error, initAuth,
      loginWithTelegram, showModal, showQRModal, closeModal
    }
  }
}
</script>

<style scoped>
.login-page {
  max-width: 700px;
  margin: 0 auto;
  padding: 40px 28px;
  min-height: 100vh;
}

.login-title {
  text-align: center;
  font-size: 24px;
  font-weight: 600;
  color: #fff;
  margin: 20px 0 28px;
}

.login-card {
  background: #0f1420;
  border: 1px solid rgba(0, 229, 255, 0.18);
  border-radius: 14px;
  padding: 28px 24px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px;
  color: rgba(255, 255, 255, 0.55);
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(0, 229, 255, 0.15);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

.login-desc {
  font-size: 13px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.45);
  text-align: center;
  margin-bottom: 18px;
}

.tg-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 13px 16px;
  border-radius: 12px;
  border: none;
  background: #229ed9;
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(34, 158, 217, 0.3);
  transition: background 0.18s ease;
}

.tg-btn:hover {
  background: #1a8bc4;
}

.tg-icon {
  width: 20px;
  height: 20px;
}

.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  color: rgba(255, 255, 255, 0.25);
  font-size: 12px;
  margin: 16px 0;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
}

.qr-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 11px 16px;
  border-radius: 10px;
  border: 1px solid rgba(0, 229, 255, 0.28);
  background: rgba(0, 229, 255, 0.07);
  color: var(--accent-color);
  font-weight: 500;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.18s;
}

.qr-btn:hover {
  background: rgba(0, 229, 255, 0.15);
}

.qr-icon {
  width: 16px;
  height: 16px;
}

.error-message {
  margin-top: 12px;
  padding: 10px 14px;
  background: rgba(255, 82, 82, 0.1);
  border: 1px solid rgba(255, 82, 82, 0.28);
  border-radius: 8px;
  color: #ff5e8a;
  font-size: 12px;
}

/* QR Модалка */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(6px);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal-content {
  background: #0f1420;
  border: 1px solid rgba(0, 229, 255, 0.18);
  border-radius: 14px;
  padding: 22px;
  width: 380px;
  max-width: 100%;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18px;
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}

.close-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  font-size: 22px;
  cursor: pointer;
  line-height: 1;
  transition: color 0.15s;
}

.close-btn:hover {
  color: #fff;
}

.modal-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.qr-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  text-align: center;
  line-height: 1.5;
  margin: 0;
}

.qr-bg {
  padding: 14px;
  background: #fff;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.error-placeholder {
  padding: 60px 40px;
  color: #ff5252;
  font-size: 13px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 600px) {
  .login-page { padding: 20px 12px; }
  .login-card { padding: 22px 18px; }
}
</style>
