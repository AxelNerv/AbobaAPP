// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
const require = createRequire(import.meta.url)
const { redact, installLogger } = require('./logger.cjs')
const { validateAuthUrl } = require('./settings.cjs')
const { createHandler } = require('./lanShare.cjs')
const temporary = []
const directory = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aboba desktop '))
  temporary.push(dir)
  return dir
}
afterEach(() => temporary.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))

describe('desktop configuration', () => {
  it('accepts HTTPS and loopback, rejects credentials and remote plain HTTP', () => {
    expect(validateAuthUrl('https://auth.example.com/')).toBe('https://auth.example.com')
    expect(validateAuthUrl('http://127.0.0.1:8010')).toBe('http://127.0.0.1:8010')
    for (const url of ['http://example.com', 'https://user:secret@example.com', 'file:///tmp', 'https://example.com/?token=x']) {
      expect(() => validateAuthUrl(url)).toThrow()
    }
  })
  it('redacts tokens, login codes and explicit secrets', () => {
    const safe = redact('bot123:SECRET /auth/poll/CODE Bearer TOKEN ?start=LOGIN key=VERYSECRET', ['VERYSECRET'])
    for (const secret of ['SECRET', 'CODE', 'TOKEN', 'LOGIN', 'VERYSECRET']) expect(safe).not.toContain(secret)
  })
  it('rotates logs and excludes secrets on disk', () => {
    const dir = directory()
    const restore = installLogger(dir, ['private-key'], 80)
    try { for (let i = 0; i < 8; i++) console.log('private-key', 'a'.repeat(80)) }
    finally { restore() }
    expect(fs.readdirSync(dir).length).toBeLessThanOrEqual(4)
    for (const file of fs.readdirSync(dir)) expect(fs.readFileSync(path.join(dir, file), 'utf8')).not.toContain('private-key')
  })
})

describe('local HTTP server', () => {
  it('survives malformed requests, missing assets and unavailable backend', async () => {
    const dir = directory()
    fs.writeFileSync(path.join(dir, 'index.html'), '<html>Aboba</html>')
    const server = http.createServer(createHandler({ distDir: dir, backendPort: 0 }))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const get = (url) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: url }, (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      }).on('error', reject)
    })
    try {
      expect(await get('/%ZZ')).toBe(400)
      expect(await get('/%00')).toBe(400)
      expect(await get('/..%5coutside')).toBe(400)
      expect(await get('/assets/missing.js')).toBe(404)
      expect(await get('/library')).toBe(200)
      expect(await get('/api-backend/ext-health')).toBe(502)
      expect(await get('/')).toBe(200)
    } finally { await new Promise((resolve) => server.close(resolve)) }
  })
})
