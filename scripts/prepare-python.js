/**
 * Готовит автономное окружение Python для установщика.
 *
 * Зачем: venv неперемещаем. В его `pyvenv.cfg` прописан путь к Python
 * в профиле разработчика, и стандартная библиотека там не лежит.
 * На чужой машине такое окружение не запустится.
 *
 * Решение — embeddable-сборка с python.org: это самодостаточная папка,
 * которой не нужен ни установленный Python, ни реестр, ни права админа.
 * Зависимости ставим колёсами прямо в её `Lib/site-packages`.
 *
 * Результат: `.pyruntime/` рядом с проектом. Скрипт идемпотентный —
 * повторный запуск ничего не делает, если версия и список зависимостей
 * не менялись.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const PYTHON_VERSION = '3.12.10'
const PYTHON_TAG = '312' // как называются python312.dll и python312._pth
const ARCH = 'amd64'

const ROOT = process.cwd()
const RUNTIME_DIR = path.join(ROOT, '.pyruntime')
const SITE_PACKAGES = path.join(RUNTIME_DIR, 'Lib', 'site-packages')
const REQUIREMENTS = path.join(ROOT, 'backend', 'requirements.txt')
const STAMP_FILE = path.join(RUNTIME_DIR, '.prepared.json')

const ZIP_URL =
  `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-${ARCH}.zip`

// Что обязано импортироваться в готовом окружении. Список короткий
// намеренно: это верхние пакеты из requirements, всё остальное —
// их зависимости и подтянется вместе с ними.
const SMOKE_IMPORTS = ['fastapi', 'uvicorn', 'pydantic', 'aiohttp', 'telegram']

const log = (msg) => console.log(`[python] ${msg}`)

/** Отпечаток: версия Python плюс содержимое requirements. */
const buildStamp = async () => {
  const requirements = await fsp.readFile(REQUIREMENTS, 'utf8')
  return {
    pythonVersion: PYTHON_VERSION,
    requirementsHash: crypto.createHash('sha256').update(requirements).digest('hex')
  }
}

const isUpToDate = async (stamp) => {
  try {
    const saved = JSON.parse(await fsp.readFile(STAMP_FILE, 'utf8'))
    return (
      saved.pythonVersion === stamp.pythonVersion &&
      saved.requirementsHash === stamp.requirementsHash &&
      fs.existsSync(path.join(RUNTIME_DIR, 'python.exe'))
    )
  } catch {
    return false
  }
}

const download = async (url, destination) => {
  log(`качаю ${path.basename(url)}`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Не удалось скачать ${url}: HTTP ${response.status}`)
  }
  await fsp.writeFile(destination, Buffer.from(await response.arrayBuffer()))
}

/**
 * Распаковка средствами самой Windows.
 *
 * Путь к tar указан полный: в PATH может стоять tar из Git Bash, а он
 * видит в `D:\...` двоеточие и принимает путь за адрес удалённой машины.
 */
const unzip = (archive, destination) => {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const attempts = [
    [path.join(systemRoot, 'System32', 'tar.exe'), ['-xf', archive, '-C', destination]],
    [
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destination}' -Force`
      ]
    ]
  ]

  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, { stdio: 'inherit' })
    if (!result.error && result.status === 0) return
  }
  throw new Error('Не удалось распаковать архив Python')
}

/**
 * В embeddable-сборке импорт site отключён, а site-packages нет в путях.
 * Без этого установленные пакеты не видны интерпретатору.
 */
const enableSitePackages = async () => {
  const pthFile = path.join(RUNTIME_DIR, `python${PYTHON_TAG}._pth`)
  const lines = (await fsp.readFile(pthFile, 'utf8'))
    .split(/\r?\n/)
    .map((line) => (line.trim() === '#import site' ? 'import site' : line))

  if (!lines.some((line) => line.trim() === 'Lib\\site-packages')) {
    const anchor = lines.findIndex((line) => line.trim() === 'import site')
    lines.splice(anchor === -1 ? lines.length : anchor, 0, 'Lib\\site-packages')
  }

  await fsp.writeFile(pthFile, lines.join('\r\n'), 'utf8')
}

/** Python, которым ставим колёса. Свой интерпретатор здесь ещё без pip. */
const findHostPython = () => {
  const candidates = [
    ['py', ['-3.12']],
    ['py', ['-3']],
    ['python', []]
  ]

  for (const [command, prefix] of candidates) {
    const probe = spawnSync(command, [...prefix, '-m', 'pip', '--version'], { encoding: 'utf8' })
    if (probe.status === 0) return { command, prefix }
  }
  return null
}

const installRequirements = async () => {
  const host = findHostPython()
  if (!host) {
    throw new Error(
      'Не найден Python с pip для установки зависимостей. ' +
        'Поставьте Python 3.12 с python.org и повторите.'
    )
  }

  await fsp.mkdir(SITE_PACKAGES, { recursive: true })
  log('ставлю зависимости из backend/requirements.txt')

  // --platform и --python-version заданы явно: колёса должны подойти
  // встроенному интерпретатору, а не тому, которым мы их ставим.
  const result = spawnSync(
    host.command,
    [
      ...host.prefix,
      '-m',
      'pip',
      'install',
      '--requirement',
      REQUIREMENTS,
      '--target',
      SITE_PACKAGES,
      '--upgrade',
      '--only-binary=:all:',
      '--platform',
      'win_amd64',
      '--python-version',
      PYTHON_VERSION.split('.').slice(0, 2).join('.'),
      '--no-compile'
    ],
    { stdio: 'inherit' }
  )

  if (result.error || result.status !== 0) {
    throw new Error('pip не смог поставить зависимости')
  }
}

/** Проверяем готовое окружение его же интерпретатором, а не хостовым. */
const smokeTest = () => {
  const python = path.join(RUNTIME_DIR, 'python.exe')
  const code = SMOKE_IMPORTS.map((name) => `import ${name}`).join('; ')
  const result = spawnSync(python, ['-c', `${code}; print('ok')`], { encoding: 'utf8' })

  if (result.status !== 0 || !String(result.stdout).includes('ok')) {
    throw new Error(
      `Окружение собрано, но импорты не прошли:\n${result.stderr || result.stdout || ''}`
    )
  }
  log('импорты проходят')
}

const main = async () => {
  const stamp = await buildStamp()

  if (await isUpToDate(stamp)) {
    log('окружение уже готово, пропускаю')
    return
  }

  // Пересобираем с нуля: остатки прошлой версии дают трудноуловимые
  // конфликты между колёсами.
  await fsp.rm(RUNTIME_DIR, { recursive: true, force: true })
  await fsp.mkdir(RUNTIME_DIR, { recursive: true })

  const archive = path.join(RUNTIME_DIR, 'python-embed.zip')
  await download(ZIP_URL, archive)
  unzip(archive, RUNTIME_DIR)
  await fsp.rm(archive, { force: true })

  await enableSitePackages()
  await installRequirements()
  smokeTest()

  await fsp.writeFile(STAMP_FILE, JSON.stringify(stamp, null, 2), 'utf8')
  log(`готово: ${RUNTIME_DIR}`)
}

main().catch((error) => {
  console.error(`[python] ${error.message}`)
  process.exit(1)
})
