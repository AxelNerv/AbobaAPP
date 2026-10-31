import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
const { readPlayback } = createRequire(import.meta.url)('./playerPlayback.cjs')

describe('чтение состояния Turbo', () => {
  it('читает только запрошенный плеер, включая вложенное видео', async () => {
    const video = { executeJavaScript: vi.fn().mockResolvedValue({ time: 50, paused: false }) }
    const main = {}
    const top = { url: 'https://abc.obrut.show/embed/serial', parent: main,
      executeJavaScript: vi.fn().mockResolvedValue(null), framesInSubtree: [video] }
    const other = { url: 'https://ads.example.org/', parent: main, executeJavaScript: vi.fn() }
    main.framesInSubtree = [main, other, top]
    expect(await readPlayback({ mainFrame: main }, top.url)).toEqual({ time: 50, paused: false })
    expect(other.executeJavaScript).not.toHaveBeenCalled()
  })
  it('не подставляет чужое окно при исчезновении Turbo', async () => {
    const main = {}
    const other = { parent: main, url: 'https://other.obrut.show/', executeJavaScript: vi.fn() }
    main.framesInSubtree = [other]
    for (const src of ['https://missing.obrut.show/', 'https://obrut.show.evil.org/', 'file:///C:/test']) {
      expect(await readPlayback({ mainFrame: main }, src)).toBeNull()
    }
    expect(other.executeJavaScript).not.toHaveBeenCalled()
  })
})
