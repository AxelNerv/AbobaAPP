/**
 * Где лежат данные приложения и как туда переехать со старого места.
 *
 * Внутрь установленного приложения писать нельзя: после упаковки папка
 * проекта лежит в архиве asar и доступна только на чтение. Поэтому база,
 * настройки и журналы живут в профиле пользователя.
 *
 * Логика вынесена из main.cjs отдельно, чтобы её можно было проверить
 * тестом, а не только запуском всего приложения.
 */
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')
const { resolvePython, resolveBackendDir } = require('./pythonEnv.cjs')

const DB_NAME = 'abobatv.db'

// SQLite сама объединяет основной файл и WAL в согласованный снимок.
const snapshotDatabase = (source, target) => {
  const appRoot = path.join(__dirname, '..')
  const python = resolvePython(appRoot)
  const backendDir = resolveBackendDir(appRoot, 'backup.py')
  if (!python || !backendDir) throw new Error('Не найдены средства переноса базы')
  execFileSync(python, [path.join(backendDir, 'backup.py'), 'snapshot', source, target], { windowsHide: true, timeout: 60000 })
}

const resolveDataDir = (userDataDir) => path.join(userDataDir, 'data')

/**
 * Разовый перенос базы из папки проекта в профиль пользователя.
 *
 * Переносим только когда в профиле базы ещё нет: иначе свежие данные
 * затёрлись бы старыми. Перед копированием оставляем копию на прежнем
 * месте — если перенос окажется неудачным, откатиться есть куда.
 *
 * Возвращает описание переноса или null, если переносить нечего.
 */
const migrateLegacyData = ({ dataDir, legacyDir, now = () => new Date(), snapshot = snapshotDatabase }) => {
  const target = path.join(dataDir, DB_NAME)
  const source = path.join(legacyDir, DB_NAME)

  if (fs.existsSync(target)) return { skipped: 'база уже есть в профиле' }
  if (!fs.existsSync(source)) return null

  const stamp = now().toISOString().replace(/[:.]/g, '-')
  const backupDir = path.join(legacyDir, `backup-${stamp}`)
  const pending = path.join(dataDir, `migration-${stamp}.pending`)

  try {
    fs.mkdirSync(backupDir, { recursive: true })
    fs.mkdirSync(dataDir, { recursive: true })

    // SQLite backup API включает зафиксированные данные WAL в единый снимок.
    snapshot(source, path.join(backupDir, DB_NAME))
    fs.copyFileSync(path.join(backupDir, DB_NAME), pending)
    // Создание ссылки атомарно и не может затереть внезапно появившуюся базу.
    fs.linkSync(pending, target)
    fs.unlinkSync(pending)

    return { migrated: true, copied: [DB_NAME], backupDir }
  } catch (error) {
    // Убираем только свой незавершённый снимок. Вызывающий код должен
    // остановить запуск: создавать пустую базу после ошибки нельзя.
    fs.rmSync(pending, { force: true })
    return { migrated: false, error: error.message }
  }
}

module.exports = { resolveDataDir, migrateLegacyData, DB_NAME }
