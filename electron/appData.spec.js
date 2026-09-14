import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { resolveDataDir, migrateLegacyData } = require('./appData.cjs')

let root
let dataDir
let legacyDir

const write = (dir, name, text) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), text, 'utf8')
}

const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8')
// Реальный SQLite backup проверяется отдельно в backend/tests/test_desktop.py.
const snapshot = (source, target) => fs.copyFileSync(source, target)

beforeEach(() => {
  // Пробел в имени намеренно: установленное приложение чаще всего лежит
  // в «Program Files», и путь с пробелом должен отрабатывать так же.
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aboba data '))
  dataDir = path.join(root, 'profile', 'data')
  legacyDir = path.join(root, 'project', 'backend', 'data')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('папка данных', () => {
  it('лежит внутри профиля пользователя', () => {
    expect(resolveDataDir(path.join(root, 'profile'))).toBe(path.join(root, 'profile', 'data'))
  })
})

describe('перенос базы в профиль', () => {
  it('переносит согласованный снимок, не копируя старый журнал', () => {
    write(legacyDir, 'abobatv.db', 'старая база')
    write(legacyDir, 'abobatv.db-wal', 'журнал')
    write(legacyDir, 'state.json', '{}')

    const result = migrateLegacyData({ dataDir, legacyDir, snapshot })

    expect(result.migrated).toBe(true)
    expect(read(dataDir, 'abobatv.db')).toBe('старая база')
    expect(fs.existsSync(path.join(dataDir, 'abobatv.db-wal'))).toBe(false)
    expect(read(result.backupDir, 'abobatv.db')).toBe('старая база')
    // Исходник остаётся нетронутым: перенос — это копия, а не перемещение.
    expect(read(legacyDir, 'abobatv.db')).toBe('старая база')
  })

  it('не переносит устаревший -shm от чужой базы', () => {
    write(legacyDir, 'abobatv.db', 'база')
    write(legacyDir, 'abobatv.db-shm', 'мусор')

    migrateLegacyData({ dataDir, legacyDir, snapshot })

    expect(fs.existsSync(path.join(dataDir, 'abobatv.db-shm'))).toBe(false)
  })

  it('не трогает базу, которая уже есть в профиле', () => {
    write(legacyDir, 'abobatv.db', 'старая база')
    write(dataDir, 'abobatv.db', 'новая база')

    const result = migrateLegacyData({ dataDir, legacyDir, snapshot })

    expect(result.migrated).toBeUndefined()
    expect(read(dataDir, 'abobatv.db')).toBe('новая база')
  })

  it('молчит, когда переносить нечего', () => {
    expect(migrateLegacyData({ dataDir, legacyDir })).toBeNull()
  })

  it('убирает за собой, если перенос оборвался на середине', () => {
    write(legacyDir, 'abobatv.db', 'база')
    write(legacyDir, 'abobatv.db-wal', 'журнал')

    // Журнал подменяем папкой: copyFileSync на ней падает, и перенос
    // обрывается уже после того, как база скопирована.
    fs.rmSync(path.join(legacyDir, 'abobatv.db-wal'))
    fs.mkdirSync(path.join(legacyDir, 'abobatv.db-wal'))

    const result = migrateLegacyData({ dataDir, legacyDir, snapshot: () => { throw new Error('Snapshot failed') } })

    expect(result.migrated).toBe(false)
    // Половинчатая база опаснее отсутствующей — её быть не должно.
    expect(fs.existsSync(path.join(dataDir, 'abobatv.db'))).toBe(false)
    expect(fs.existsSync(path.join(dataDir, 'abobatv.db-wal'))).toBe(false)
  })
})
