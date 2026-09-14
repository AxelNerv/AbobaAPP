/**
 * Отдельный экземпляр приложения рядом с основным.
 *
 * Зачем: стабильная копия для просмотра живёт рядом с рабочей сборкой, которую
 * пересобирают по десять раз в день. Обычно вторая копия не запустилась бы
 * вовсе — замок единственного экземпляра и порты у них общие.
 *
 * Файл instance.json рядом с AbobaTV.exe задаёт имя и порты. От имени
 * зависит папка профиля, а значит и замок экземпляра, база и вход.
 * Нет файла — обычная сборка с привычными портами.
 */
const fs = require('fs')
const path = require('path')

const DEFAULTS = { name: 'AbobaTV', backendPort: 8765, localPort: 5310, sharePort: 5210 }

const validPort = (value) => Number.isInteger(value) && value >= 1024 && value <= 65535

/**
 * Кривой файл роняет запуск, а не игнорируется: молча взятые порты
 * по умолчанию столкнули бы копию с основной сборкой — ровно то,
 * от чего файл и должен защищать.
 */
const readInstance = (dir = path.dirname(process.execPath)) => {
  const file = path.join(dir, 'instance.json')
  if (!fs.existsSync(file)) return { ...DEFAULTS, file: null }

  const data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }
  const ports = [data.backendPort, data.localPort, data.sharePort]

  if (typeof data.name !== 'string' || !/^[\p{L}\p{N} ._-]{1,40}$/u.test(data.name)) {
    throw new Error(`instance.json: недопустимое имя «${data.name}»`)
  }
  if (!ports.every(validPort)) {
    throw new Error('instance.json: порты должны быть целыми числами от 1024 до 65535')
  }
  if (new Set(ports).size !== ports.length) {
    throw new Error('instance.json: порты бэкенда, окна и раздачи должны различаться')
  }

  return { name: data.name, backendPort: data.backendPort, localPort: data.localPort, sharePort: data.sharePort, file }
}

module.exports = { ...readInstance(), readInstance, DEFAULTS }
