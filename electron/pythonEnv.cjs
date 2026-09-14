/**
 * Поиск Python и папки backend — общий для бэкенда и бота.
 *
 * `.pyruntime` — автономная сборка с python.org, её же установщик кладёт
 * в `resources/python`: она работает на машине, где Python не установлен вовсе.
 */
const path = require('path')
const fs = require('fs')

const firstExisting = (candidates) =>
  candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null

const resolvePython = (appRoot) =>
  firstExisting([
    path.join(appRoot, '.pyruntime', 'python.exe'),
    path.join(process.resourcesPath || '', 'python', 'python.exe')
  ])

/** Папка backend ищется по конкретному файлу, а не по самому факту папки. */
const resolveBackendDir = (appRoot, marker) => {
  const candidates = [
    path.join(appRoot, 'backend'),
    path.join(process.resourcesPath || '', 'backend')
  ]
  return candidates.find((dir) => fs.existsSync(path.join(dir, marker))) || null
}

module.exports = { resolvePython, resolveBackendDir }
