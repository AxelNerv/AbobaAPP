const fs = require('fs')
const path = require('path')

const validateAuthUrl = (value) => {
  if (!String(value || '').trim()) return ''
  const url = new URL(String(value).trim())
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('Укажите HTTPS-адрес сервера без пароля и параметров. HTTP разрешён только на этом компьютере.')
  }
  return url.href.replace(/\/$/, '')
}

const readSettings = (userDir) => {
  const file = path.join(userDir, 'settings.json')
  if (!fs.existsSync(file)) return { authServerUrl: '', closeToTray: false, adblock: true }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  // Блокировщик включён, пока его явно не выключили: старые файлы настроек
  // и копии, восстановленные из бэкапа, этого поля не знают.
  return {
    authServerUrl: validateAuthUrl(data.authServerUrl),
    closeToTray: data.closeToTray === true,
    adblock: data.adblock !== false
  }
}

const saveSettings = (userDir, settings) => {
  const data = {
    authServerUrl: validateAuthUrl(settings.authServerUrl),
    closeToTray: settings.closeToTray === true,
    adblock: settings.adblock !== false
  }
  fs.mkdirSync(userDir, { recursive: true })
  const target = path.join(userDir, 'settings.json')
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(data, null, 2))
  fs.renameSync(`${target}.tmp`, target)
  return data
}

module.exports = { readSettings, saveSettings, validateAuthUrl }
