/**
 * Раздача сайта по локальной сети.
 *
 * Поднимает HTTP-сервер на всех интерфейсах: отдаёт собранный фронт и
 * проксирует /api-backend на локальный бэкенд. Телефон в той же сети
 * открывает адрес в браузере и попадает в тот же профиль с той же
 * историей — база одна на всех.
 */
const http = require('http')
const os = require('os')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const instance = require('./instance.cjs')

const SHARE_PORT = instance.sharePort
// У отдельного экземпляра свой порт — и своё правило, иначе проверка
// приняла бы чужое правило за открытый доступ.
const FIREWALL_RULE =
  instance.sharePort === instance.DEFAULTS.sharePort
    ? 'AbobaTV — раздача по Wi-Fi'
    : `AbobaTV — раздача по Wi-Fi (порт ${SHARE_PORT})`

let server = null
let localServer = null
const LOCAL_PORT = instance.localPort // окно приложения ходит сюда, а не через file://

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
}

/** Адрес компьютера в локальной сети — тот, что вводят на телефоне. */
const getLanAddress = () => {
  return getLanAddresses()[0]?.address || null
}

const getLanAddresses = () => {
  const nets = os.networkInterfaces()
  const candidates = []

  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue
      // Виртуальные адаптеры (WSL, Hyper-V, VPN) телефону недоступны —
      // отдать их значит дать заведомо нерабочий адрес.
      const virtual = /WSL|Hyper-V|VirtualBox|VMware|Radmin|Default Switch|vEthernet|VPN|WireGuard|Tailscale|ZeroTier|TAP|TUN/i.test(name)
      candidates.push({ name, address: a.address, virtual })
    }
  }

  return candidates.filter((c) => !c.virtual && !c.address.startsWith('169.254.'))
}

const proxyToBackend = (req, res, backendPort) => {
  const fail = () => {
    if (res.destroyed || res.writableEnded) return
    if (res.headersSent) { res.destroy(); return }
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ detail: 'Бэкенд не отвечает' }))
  }
  const targetPath = req.url.replace(/^\/api-backend/, '') || '/'
  const proxyReq = http.request(
    {
      host: '127.0.0.1',
      port: backendPort,
      path: targetPath,
      method: req.method,
      timeout: 20000,
      headers: { ...req.headers, host: `127.0.0.1:${backendPort}` }
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
      proxyRes.pipe(res)
      proxyRes.on('error', fail)
      proxyRes.on('aborted', fail)
    }
  )

  proxyReq.on('error', fail)
  proxyReq.on('timeout', () => proxyReq.destroy(new Error('Backend timeout')))
  req.on('aborted', () => proxyReq.destroy())
  res.on('close', () => { if (!res.writableEnded) proxyReq.destroy() })

  req.pipe(proxyReq)
}

const serveStatic = (req, res, distDir) => {
  // Кривое процентное кодирование (например /%ZZ) роняет decodeURIComponent.
  // Без этой проверки один битый запрос с телефона убивал раздачу целиком.
  let urlPath
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    if (/[\\:]/.test(urlPath) || [...urlPath].some((c) => c.charCodeAt(0) < 32)) throw new Error('Invalid path')
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Некорректный адрес')
    return
  }

  const root = path.resolve(distDir)
  let filePath = path.resolve(root, '.' + path.posix.normalize(urlPath))

  // Сравниваем с разделителем на конце: иначе путь-сосед с тем же началом
  // (dist-old рядом с dist) прошёл бы проверку как «внутри».
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Доступ запрещён')
    return
  }

  let stat = null
  try {
    stat = fs.statSync(filePath)
  } catch {
    stat = null
  }

  if (stat?.isDirectory()) {
    filePath = path.join(filePath, 'index.html')
    stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null
  }

  // Маршрута Vue на диске нет — отдаём index.html, чтобы роутер разобрался
  // сам. Но только для страниц: отсутствующая картинка или скрипт должны
  // честно отвечать 404, а не отдавать HTML с кодом 200.
  if (!stat) {
    const ext = path.extname(filePath).toLowerCase()
    if (ext && ext !== '.html') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Не найдено')
      return
    }
    filePath = path.join(root, 'index.html')
  }

  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })

  const stream = fs.createReadStream(filePath)
  stream.on('error', () => {
    // Заголовки уже ушли — дописать ошибку нельзя, просто закрываем
    res.destroy()
  })
  stream.pipe(res)
}

/** Один обработчик на оба сервера: локальный и раздающий. */
const createHandler = ({ distDir, backendPort }) => (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (/^\/api-backend(?:\/|\?|$)/.test(req.url || '')) {
    proxyToBackend(req, res, backendPort)
  } else {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
    serveStatic(req, res, distDir)
  }
}

/**
 * Сервер для самого окна. Через file:// собранный сайт не работает:
 * ссылки на ресурсы вида /assets/... ведут в корень диска, а не в папку
 * сборки, и экран остаётся пустым. Плюс так работает history-роутинг.
 */
const startLocal = ({ distDir, backendPort }) =>
  new Promise((resolve, reject) => {
    if (localServer) {
      resolve(`http://127.0.0.1:${LOCAL_PORT}`)
      return
    }
    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
      reject(new Error('Нет собранного сайта. Соберите: yarn build'))
      return
    }
    localServer = http.createServer(createHandler({ distDir, backendPort }))
    localServer.on('error', (err) => {
      localServer = null
      reject(err)
    })
    localServer.listen(LOCAL_PORT, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${LOCAL_PORT}`)
    )
  })

const stopLocal = () => {
  if (!localServer) return
  localServer.close()
  localServer.closeAllConnections()
  localServer = null
}

const startSharing = ({ distDir, backendPort }) =>
  new Promise((resolve, reject) => {
    if (!getLanAddress()) { reject(new Error('Нет подходящего сетевого адреса. Подключитесь к Wi-Fi или Ethernet.')); return }
    if (server) {
      resolve({ url: buildUrl(), port: SHARE_PORT, alreadyRunning: true })
      return
    }

    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
      reject(new Error('Нет собранного сайта. Сначала соберите его: yarn build'))
      return
    }

    server = http.createServer(createHandler({ distDir, backendPort }))

    server.on('error', (err) => {
      server = null
      reject(err)
    })

    server.listen(SHARE_PORT, '0.0.0.0', () => {
      resolve({ url: buildUrl(), port: SHARE_PORT, alreadyRunning: false })
    })
  })

const buildUrl = () => {
  const ip = getLanAddress()
  return ip ? `http://${ip}:${SHARE_PORT}` : null
}

const stopSharing = () =>
  new Promise((resolve) => {
    if (!server) {
      resolve(false)
      return
    }
    server.close(() => {
      server = null
      resolve(true)
    })
    server.closeAllConnections()
  })

const isSharing = () => !!server

/** Есть ли правило в брандмауэре — без него телефон не достучится. */
const powershell = (script, timeout = 10000) => new Promise((resolve) => {
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout }, (err, stdout) => resolve({ ok: !err, output: String(stdout || '').trim() }))
})

const checkFirewall = async () => {
  const result = await powershell(`$r = Get-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }; $p = $r | Get-NetFirewallPortFilter | Where-Object { $_.LocalPort -eq '${SHARE_PORT}' -and $_.Protocol -eq 'TCP' }; [bool]$p`)
  return result.ok && result.output.toLowerCase() === 'true'
}

/**
 * Открыть порт в брандмауэре. Требует прав администратора — Windows
 * покажет запрос. Правило ограничено локальной сетью, наружу порт не
 * открывается.
 */
const openFirewall = async () => {
  if (await checkFirewall()) return true
  const inner = `$ErrorActionPreference = 'Stop'; try { New-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -Direction Inbound -Protocol TCP -LocalPort ${SHARE_PORT} -RemoteAddress LocalSubnet -Profile Private -Action Allow | Out-Null; exit 0 } catch { exit 1 }`
  const encoded = Buffer.from(inner, 'utf16le').toString('base64')
  const result = await powershell(`$ErrorActionPreference = 'Stop'; try { $p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile -NonInteractive -EncodedCommand ${encoded}'; exit $p.ExitCode } catch { exit 1 }`, 90000)
  return result.ok && await checkFirewall()
}

module.exports = {
  startLocal,
  stopLocal,
  LOCAL_PORT,
  startSharing,
  stopSharing,
  isSharing,
  getLanAddress,
  getLanAddresses,
  checkFirewall,
  openFirewall,
  buildUrl,
  SHARE_PORT,
  createHandler
}
