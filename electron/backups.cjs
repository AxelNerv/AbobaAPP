const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')
const { resolvePython, resolveBackendDir } = require('./pythonEnv.cjs')

const runBackup = (appRoot, command, profile, target) => new Promise((resolve, reject) => {
  const python = resolvePython(appRoot)
  const dir = resolveBackendDir(appRoot, 'backup.py')
  if (!python || !dir) return reject(new Error('Не найдены средства резервного копирования'))
  execFile(python, [path.join(dir, 'backup.py'), command, profile, target],
    { windowsHide: true, timeout: 60000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message))
      else resolve(target)
    })
})

const createBackup = async (appRoot, profile) => {
  const directory = path.join(profile, 'backups')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, `abobatv-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`)
  await runBackup(appRoot, 'create', profile, file)
  return file
}

module.exports = { runBackup, createBackup }
