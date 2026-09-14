const fs = require('fs')
const path = require('path')
const util = require('util')

const redact = (text, secrets = []) => {
  let result = String(text)
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[REDACTED]')
    .replace(/(Bearer\s+)\S+/gi, '$1[REDACTED]')
    .replace(/(\/auth\/poll\/)[^\s?"']+/g, '$1[REDACTED]')
    .replace(/([?&](?:start|token|api_key|code)=)[^&\s"']+/gi, '$1[REDACTED]')
  for (const secret of secrets.filter((x) => typeof x === 'string' && x.length >= 4)) {
    result = result.split(secret).join('[REDACTED]')
  }
  return result
}

const installLogger = (directory, secrets = [], maxBytes = 1024 * 1024) => {
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, 'app.log')
  const originals = {}
  for (const level of ['log', 'warn', 'error']) {
    originals[level] = console[level]
    console[level] = (...args) => {
      const message = redact(util.format(...args), secrets).slice(0, 32000)
      originals[level](message)
      try {
        if (fs.existsSync(file) && fs.statSync(file).size >= maxBytes) {
          for (let index = 3; index >= 1; index--) {
            const older = `${file}.${index}`
            if (index === 3 && fs.existsSync(older)) fs.unlinkSync(older)
            const previous = index === 1 ? file : `${file}.${index - 1}`
            if (fs.existsSync(previous)) fs.renameSync(previous, older)
          }
        }
        fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${message}\n`)
      } catch { /* Ошибка записи журнала не должна рекурсивно вызывать logger. */ }
    }
  }
  return () => Object.assign(console, originals)
}

module.exports = { installLogger, redact }
