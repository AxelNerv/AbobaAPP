/**
 * Значок ярлыков Windows под тему.
 *
 * Окно и трей меняют значок сами (windowTheme.cjs), а ярлыки в «Пуске»,
 * на рабочем столе и на панели задач берут его из AbobaTV.exe — тему они
 * не видят. Здесь у ярлыков AbobaTV меняется только значок: цель, AUMID
 * и остальное остаются как есть, поэтому закрепления не слетают.
 * Хэллоуин — свой .ico рядом с приложением, классика — снова значок
 * самого exe, как его ставит установщик.
 *
 * Ярлыки установки «для всех пользователей» (ProgramData, общий рабочий
 * стол) без прав администратора часто не изменить. Такой ярлык
 * пропускается молча и до перезапуска больше не трогается.
 */
const path = require('path')
const fs = require('fs')

const NAME = 'AbobaTV'
const THEMES = ['classic', 'halloween']

const samePath = (a, b) => !!a && !!b &&
  path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase()

const shortcutPaths = ({ appData, desktop, publicDesktop, programData }) => [
  appData && path.win32.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${NAME}.lnk`),
  programData && path.win32.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${NAME}.lnk`),
  desktop && path.win32.join(desktop, `${NAME}.lnk`),
  publicDesktop && path.win32.join(publicDesktop, `${NAME}.lnk`),
  appData && path.win32.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', `${NAME}.lnk`)
].filter(Boolean)

const createShortcutIcons = ({ shell, paths, halloweenIcon, ownsTarget, exists = fs.existsSync }) => {
  // Тема применяется при каждом изменении оформления: ярлык без прав
  // не переписываем снова и снова, хватит одной попытки за запуск.
  const denied = new Set()
  return (theme) => {
    const result = { updated: [], failed: [] }
    if (!THEMES.includes(theme)) return result
    // Без файла значка ярлык остался бы с пустой картинкой — лучше не трогать.
    if (theme === 'halloween' && !exists(halloweenIcon)) return result
    for (const file of paths) {
      if (!exists(file)) continue
      let link
      try { link = shell.readShortcutLink(file) } catch { continue }
      if (!link?.target || !ownsTarget(link.target)) continue
      const icon = theme === 'halloween' ? halloweenIcon : link.target
      if (samePath(link.icon, icon) && !link.iconIndex) continue
      const key = `${file}|${icon}`
      if (denied.has(key)) continue
      let ok = false
      try { ok = shell.writeShortcutLink(file, 'update', { icon, iconIndex: 0 }) } catch { ok = false }
      if (ok) result.updated.push(file)
      else { denied.add(key); result.failed.push(file) }
    }
    return result
  }
}

module.exports = { createShortcutIcons, shortcutPaths, samePath }
