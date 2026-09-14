import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import eslintPlugin from 'vite-plugin-eslint'

const base = process.env.VITE_BASE_URL || '/'

export default defineConfig(({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) }
  if (mode === 'desktop') {
    process.env.VITE_AUTH_BACKEND_URL = '/api-backend'
    process.env.VITE_KINOBD_API_URL = '/api-backend/ext/kinobd'
    process.env.VITE_APP_API2_URL = '/api-backend/ext/kinobd'
    process.env.VITE_BASE_URL = '/'
  }
  const isDistEnv = process.env.NODE_ENV === 'production'
  const now = new Date()
  const formattedDate =
    now
      .toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'UTC'
      })
      .replace(/[.,]/g, '_')
      .replace(/\s+/g, '') + '_UTC'
  process.env.VITE_APP_VERSION_FULL_VERSION = process.env.VITE_APP_VERSION + '_' + formattedDate

  return {
    base: mode === 'desktop' ? '/' : base,
    plugins: [
      vue(),
      VitePWA({
        disable: true,
        registerType: 'autoUpdate',
        injectRegister: 'inline',
        includeAssets: ['favicon.ico'],
        workbox: {
          clientsClaim: true,
          skipWaiting: true,
          maximumFileSizeToCacheInBytes: 3000000
        },
        manifest: {
          name: 'AbobaTv',
          short_name: 'AbobaTv',
          description: 'AbobaTv - Просмотр фильмов и сериалов онлайн',
          theme_color: '#0a0e1a',
          background_color: '#0a0e1a',
          display: 'standalone',
          scope: base,
          start_url: base,

          icons: [
            {
              src: `${base}web-app-manifest-192x192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable'
            },
            {
              src: `${base}web-app-manifest-512x512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        }
      }),
      eslintPlugin({
        include: ['src/**/*.js', 'src/**/*.vue', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx'],
        failOnError: true,
        failOnWarning: false,
        cache: false,
        emitError: true
      })
    ],
    resolve: {
      alias: {
        '@': '/src'
      }
    },
    // Раньше этот блок лежал ВНУТРИ опций VitePWA — то есть Vite его не видел
    // и настройки имён чанков просто не применялись.
    build: {
      rollupOptions: {
        output: {
          assetFileNames: (assetInfo) => {
            const name = assetInfo.name || ''
            const extType = name.split('.').pop() || 'misc'
            return `assets/${extType}/[name]-[hash][extname]`
          },
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js'
        }
      }
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: false,
      cors: true,
      // allowedHosts: 'all' — принимать любые Host-заголовки (важно для мобильной сети)
      allowedHosts: 'all',
      hmr: {
        // Отключаем HMR WebSocket чтобы не было проблем с соединением с мобильного
        // (сайт всё равно работает без hot-reload)
        clientPort: 5200,
        overlay: false
      },
      // Docker на Windows: события об изменении файлов не проходят через
      // bind-mount в WSL2, поэтому inotify молчит и Vite отдаёт старый модуль.
      // Без опроса смонтированные исходники бесполезны — правки не подхватываются.
      watch: {
        usePolling: true,
        interval: 400
      },
      // Прокси /api-backend/* на наш FastAPI.
      proxy: {
        '/api-backend': {
          target: process.env.ABOBA_DEV === '1' ? 'http://127.0.0.1:8765' : 'http://backend:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-backend/, '')
        }
      }
    }
  }
})
