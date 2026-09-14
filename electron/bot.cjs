/**
 * Telegram-бот внутри приложения.
 *
 * Зачем здесь: код входа живёт в памяти того бэкенда, который его выдал.
 * Пока бот работал в Docker, он подтверждал вход контейнерному бэкенду,
 * а сайт в приложении брал код у своего — и вход падал с «код устарел».
 * Теперь бот и бэкенд всегда одна пара.
 *
 * Важно: у одного токена может быть только один бот. Если где-то ещё
 * запущен контейнер с тем же токеном, Telegram отдаёт обновления только
 * одному, второй получает 409.
 */
const { spawn } = require('child_process')

const { resolvePython, resolveBackendDir } = require('./pythonEnv.cjs')

let botProcess = null
let lastError = null

const startBot = (appRoot, env = {}, backendPort) => {
  if (botProcess) return { running: true, alreadyRunning: true }

  const token = env.ABOBA_BOT_TOKEN || ''
  if (!token) {
    lastError = 'В .env не задан ABOBA_BOT_TOKEN'
    return { running: false, error: lastError }
  }

  const python = resolvePython(appRoot)
  const botDir = resolveBackendDir(appRoot, 'bot.py')
  if (!python || !botDir) {
    lastError = 'Не найдено окружение Python или файл bot.py'
    return { running: false, error: lastError }
  }

  lastError = null
  botProcess = spawn(python, ['bot.py'], {
    cwd: botDir,
    env: {
      ...process.env,
      BOT_TOKEN: token,
      ADMIN_KEY: env.ABOBA_ADMIN_KEY || '',
      ADMIN_IDS: env.ABOBA_ADMIN_IDS || '',
      SERVER_URL: `http://127.0.0.1:${backendPort}`,
      PYTHONUNBUFFERED: '1'
    },
    windowsHide: true
  })

  const note = (d) => {
    const text = String(d).trim()
    if (!text) return
    console.log('[bot]', text)
    // 409 — верный признак, что тот же токен уже кем-то занят.
    // Продолжать опрос бессмысленно и вредно: два процесса на одном токене
    // перехватывают обновления друг у друга, и вход ломается у обоих.
    // Уступаем тому, кто занял токен первым.
    // Ищем именно подпись ошибки, а не число: «409» встречается и в
    // обычных строках журнала (идентификаторы, тексты сообщений), и по
    // такому совпадению бот выключался бы ни за что.
    if (/telegram\.error\.Conflict|Conflict: terminated/i.test(text)) {
      lastError = 'Бот уже запущен в другом месте (например, в Docker) — здесь он выключен'
      stopBot()
    }
  }

  botProcess.stdout?.on('data', note)
  botProcess.stderr?.on('data', note)
  botProcess.on('exit', (code) => {
    console.log('[bot] завершился, код', code)
    botProcess = null
  })

  return { running: true, alreadyRunning: false }
}

const stopBot = () => {
  if (!botProcess) return
  botProcess.kill()
  botProcess = null
}

const botStatus = () => ({ running: !!botProcess, error: lastError })

module.exports = { startBot, stopBot, botStatus }
