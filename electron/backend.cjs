/**
 * Запуск бэкенда (FastAPI) внутри приложения.
 *
 * Docker больше не нужен: рядом с приложением лежит окружение Python
 * с уже установленными зависимостями, и мы просто поднимаем uvicorn.
 * База остаётся файлом на диске — её же читает и телефон, который зашёл
 * по wifi, поэтому история у приложения и браузера общая.
 *
 * Папку с базой задаёт main.cjs: внутри установленного приложения писать
 * нельзя, данные живут в профиле пользователя.
 *
 * Готовность проверяется не «кто-то ответил на порту», а по метке, которую
 * мы сами выдали этому запуску. Иначе чужой сервис на 8765 — соседний
 * контейнер, забытый процесс — сошёл бы за свой бэкенд, и приложение
 * молча работало бы с чужой базой.
 */
const { spawn, spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')
const crypto = require('crypto')

const { resolvePython, resolveBackendDir } = require('./pythonEnv.cjs')
const instance = require('./instance.cjs')

// Свой порт, чтобы не спорить с Docker (8001/8002). Отдельный экземпляр
// берёт другой из instance.json.
const BACKEND_PORT = instance.backendPort

// Метка живёт ровно один запуск приложения: перезапустились — она другая.
const INSTANCE_ID = crypto.randomUUID()

// Перезапуски ограничены: если бэкенд падает сразу после старта, бесконечный
// цикл только сожжёт процессор и спрячет причину.
const MAX_RESTARTS = 3
const RESTART_DELAY_MS = 1500
// Сколько бэкенд должен продержаться, чтобы падение считалось разовым.
const STABLE_RUN_MS = 5 * 60 * 1000

let backendProcess = null
let launchConfig = null
let stopRequested = false
let starting = false
let restartTimer = null
let restarts = 0
let lastReadyAt = 0
let lastError = null
let onStatus = () => {}

const report = (state, detail) => {
  if (detail) console.log('[backend]', state, '—', detail)
  try {
    onStatus({ state, detail: detail || '', running: !!backendProcess })
  } catch {
    // Окно могло уже закрыться — падать из-за уведомления не станем.
  }
}

/** Один запрос к /ext-health. Возвращает разобранный ответ или null. */
const probeHealth = (port, timeoutMs = 2000) =>
  new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/ext-health', timeout: timeoutMs },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('aborted', () => resolve(null))
        res.on('error', () => resolve(null))
        res.on('data', (chunk) => {
          body += chunk
          // Ответ маленький; если пришло много — это точно не наш бэкенд.
          if (body.length > 64 * 1024) req.destroy()
        })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) })
          } catch {
            resolve({ status: res.statusCode, body: null })
          }
        })
      }
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => req.destroy())
  })

const isOurs = (health) => health?.status === 200 && health.body?.instance === INSTANCE_ID

/**
 * Ждём не «процесс создан», а ответ с нашей меткой.
 *
 * Если процесс успел умереть — не ждём таймаут впустую: чаще всего это
 * занятый порт или ошибка в окружении, и причина уже в журнале.
 */
const waitUntilReady = (port, timeoutMs = 30000) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const attempt = async () => {
      if (!backendProcess) {
        reject(new Error(lastError || 'Бэкенд завершился, не успев ответить'))
        return
      }

      const health = await probeHealth(port, 2000)
      if (isOurs(health)) {
        resolve(true)
        return
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(
          new Error(
            health
              ? `Порт ${port} занят другой программой — она ответила, но это не наш бэкенд`
              : 'Бэкенд не ответил за отведённое время'
          )
        )
        return
      }
      setTimeout(attempt, 400)
    }
    attempt()
  })

const spawnBackend = () => {
  const { python, backendDir, dataDir, env } = launchConfig

  const child = spawn(
    python,
    ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
    {
      cwd: backendDir,
      env: {
        ...process.env,
        STATE_FILE: path.join(dataDir, 'state.json'),
        ADMIN_KEY: env.ADMIN_KEY || '',
        TMDB_API_KEY: env.TMDB_API_KEY || '',
        AUTH_MODE: 'client',
        AUTH_SERVER_URL: env.AUTH_SERVER_URL || '',
        ABOBA_INSTANCE_ID: INSTANCE_ID,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      },
      windowsHide: true
    }
  )

  const note = (d) => {
    const text = String(d).trim()
    if (!text) return
    console.log('[backend]', text)
    // Занятый порт uvicorn сообщает текстом и сразу выходит.
    if (/address already in use|Errno 10048/i.test(text)) {
      lastError = `Порт ${BACKEND_PORT} уже занят`
    }
  }

  child.stdout?.setEncoding('utf8').on('data', note)
  child.stderr?.setEncoding('utf8').on('data', note)

  child.on('error', (err) => {
    if (backendProcess !== child) return
    lastError = `Не удалось запустить процесс: ${err.message}`
    backendProcess = null
    report('failed', lastError)
  })

  child.on('exit', (code) => {
    if (backendProcess !== child) return
    backendProcess = null
    if (stopRequested) {
      console.log('[backend] остановлен')
      return
    }
    // Пока идёт запуск, решение принимает тот, кто его ждёт. Иначе выход
    // процесса и неудачное ожидание запланировали бы по перезапуску каждый,
    // и счётчик попыток сгорал бы вдвое быстрее.
    if (starting) return
    report('stopped', `завершился сам, код ${code}`)
    scheduleRestart()
  })

  backendProcess = child
}

/** Поднять процесс и дождаться его ответа. Бросает, если не поднялся. */
const launchAndWait = async () => {
  starting = true
  try {
    spawnBackend()
    await waitUntilReady(BACKEND_PORT)
    lastReadyAt = Date.now()
  } finally {
    starting = false
  }
}

/**
 * Ограниченное восстановление.
 *
 * Счётчик считает падения подряд. Если бэкенд отработал достаточно долго,
 * прежде чем упасть, это не «падает при запуске», а разовый сбой — начинаем
 * счёт заново, иначе за месяц работы три случайные осечки навсегда лишили бы
 * приложение восстановления.
 */
const scheduleRestart = () => {
  if (stopRequested || !launchConfig || restartTimer) return

  if (lastReadyAt && Date.now() - lastReadyAt > STABLE_RUN_MS) restarts = 0

  if (restarts >= MAX_RESTARTS) {
    report(
      'failed',
      `бэкенд падает при запуске (попыток: ${restarts}). ${lastError || 'Причина в журнале.'}`
    )
    return
  }

  restarts += 1
  report('restarting', `попытка ${restarts} из ${MAX_RESTARTS}`)
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (stopRequested || backendProcess) return
    launchAndWait().then(
      () => report('ready', 'бэкенд восстановлен'),
      (err) => {
        lastError = err.message
        // Процесс мог остаться живым, но негодным — убираем, чтобы не мешал.
        killTree(backendProcess)
        backendProcess = null
        scheduleRestart()
      }
    )
  }, RESTART_DELAY_MS)
}

/**
 * В Windows kill() снимает только сам процесс. uvicorn обычно живёт один,
 * но если он успел обзавестись потомками, они остались бы висеть и держать порт.
 */
const killTree = (child) => {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try {
    child.kill()
  } catch {
    // Уже мёртв — ничего делать не нужно.
  }
}

const startBackend = async (appRoot, env = {}, dataDir, hooks = {}) => {
  if (backendProcess) return { port: BACKEND_PORT, alreadyRunning: true }

  onStatus = hooks.onStatus || onStatus

  const python = resolvePython(appRoot)
  const backendDir = resolveBackendDir(appRoot, 'server.py')

  if (!python) throw new Error('Не найдено окружение Python')
  if (!backendDir) throw new Error('Не найдена папка backend с server.py')
  if (!dataDir) throw new Error('Не задана папка для данных')

  // Смотрим на порт до запуска: иначе uvicorn упадёт, а мы полминуты
  // будем ждать ответа от чужой программы.
  const occupied = await probeHealth(BACKEND_PORT, 1500)
  if (occupied) {
    throw new Error(
      `Порт ${BACKEND_PORT} занят другой программой.\n` +
        'Скорее всего это второй экземпляр AbobaTV или контейнер в Docker. ' +
        'Закройте его и запустите приложение заново.'
    )
  }

  fs.mkdirSync(dataDir, { recursive: true })

  stopRequested = false
  restarts = 0
  lastError = null
  launchConfig = { python, backendDir, dataDir, env }

  try {
    await launchAndWait()
  } catch (error) {
    stopBackend()
    throw error
  }
  report('ready', '')

  return { port: BACKEND_PORT, alreadyRunning: false }
}

const stopBackend = () => {
  stopRequested = true
  launchConfig = null
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (!backendProcess) return
  const child = backendProcess
  backendProcess = null
  killTree(child)
}

const isBackendRunning = () => !!backendProcess

const backendStatus = () => ({
  running: !!backendProcess,
  restarts,
  error: lastError
})

module.exports = {
  startBackend,
  stopBackend,
  isBackendRunning,
  backendStatus,
  BACKEND_PORT,
  INSTANCE_ID
}
