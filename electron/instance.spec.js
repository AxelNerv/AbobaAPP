import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { readInstance, DEFAULTS } = require('./instance.cjs')

let dir
const write = (data) => fs.writeFileSync(path.join(dir, 'instance.json'), JSON.stringify(data))

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aboba instance '))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('отдельный экземпляр', () => {
  it('без файла — обычная сборка', () => {
    expect(readInstance(dir)).toMatchObject({ ...DEFAULTS, file: null })
  })

  it('берёт имя и порты из файла', () => {
    write({ name: 'AbobaTV Watch', backendPort: 8775, localPort: 5320, sharePort: 5220 })
    expect(readInstance(dir)).toMatchObject({ name: 'AbobaTV Watch', backendPort: 8775, localPort: 5320, sharePort: 5220 })
  })

  it('не молчит о кривых портах', () => {
    write({ name: 'Watch', backendPort: 80 })
    expect(() => readInstance(dir)).toThrow(/порты/)
    write({ name: 'Watch', backendPort: 5320, localPort: 5320, sharePort: 5220 })
    expect(() => readInstance(dir)).toThrow(/различаться/)
  })

  it('не пускает в имя путь', () => {
    write({ name: '../../evil' })
    expect(() => readInstance(dir)).toThrow(/имя/)
  })
})
