import vuePlugin from 'eslint-plugin-vue'
import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'

export default [
  js.configs.recommended,
  ...vuePlugin.configs['flat/recommended'],
  prettierConfig,
  {
    // Настройка окружения
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        // Глобальные переменные для браузера
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        navigator: 'readonly',
        process: 'readonly', // Для переменных, связанных с Node.js
        URLSearchParams: 'readonly', // Для работы с URLSearchParams
        URL: 'readonly',
        Image: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        // Без него падала production-сборка: в vite.config у eslint-плагина
        // стоит failOnError, а TopMovies.vue использует IntersectionObserver
        // для бесконечного скролла.
        IntersectionObserver: 'readonly',
        ResizeObserver: 'readonly',
        MutationObserver: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        WebSocket: 'readonly',
        TextEncoder: 'readonly',
        crypto: 'readonly',
        btoa: 'readonly',
        atob: 'readonly'
      }
    },
    rules: {
      'no-console': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      // Кавычки
      quotes: ['error', 'single', { avoidEscape: true }], // Одинарные кавычки, кроме случаев, когда нужны двойные
      // Точки с запятой
      semi: ['error', 'never'], // Без точек с запятой
      // Trailing commas
      'comma-dangle': ['error', 'never'], // Без trailing commas
      // Vue-specific rules
      'vue/html-self-closing': [
        'error',
        {
          html: {
            void: 'always',
            normal: 'never',
            component: 'always'
          },
          svg: 'always',
          math: 'always'
        }
      ],
      'vue/require-default-prop': 'off',
      'vue/multi-word-component-names': 'off' // Отключаем правило для однословных компонентов
    }
  },
  {
    // Код приложения и сборочные скрипты живут в Node, а не в браузере.
    // Раньше они не проверялись вовсе — и удалённая по невнимательности
    // функция окна доехала бы до сборки незамеченной.
    files: ['electron/**/*.cjs', 'electron/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        require: 'readonly',
        module: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly'
      }
    }
  },
  {
    files: ['electron/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' }
  }
]
