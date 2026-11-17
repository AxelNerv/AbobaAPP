// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
const { createShortcutIcons, shortcutPaths } = createRequire(import.meta.url)('./shortcutIcons.cjs')

const EXE = 'D:\\AbobaTV\\AbobaTV.exe'
const ICO = 'D:\\AbobaTV\\resources\\icons\\icon-halloween.ico'
const START = 'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\AbobaTV.lnk'
const DESKTOP = 'C:\\Users\\Public\\Desktop\\AbobaTV.lnk'

const fakeShell = (links, readOnly = []) => ({
  readShortcutLink: vi.fn((file) => ({ ...links[file] })),
  writeShortcutLink: vi.fn((file, operation, options) => {
    if (operation !== 'update' || readOnly.includes(file)) return false
    links[file] = { ...links[file], ...options }
    return true
  })
})

const setup = (links, readOnly) => {
  const shell = fakeShell(links, readOnly)
  const update = createShortcutIcons({
    shell,
    paths: [...Object.keys(links), 'C:\\missing\\AbobaTV.lnk'],
    halloweenIcon: ICO,
    ownsTarget: (target) => target.toLowerCase() === EXE.toLowerCase(),
    exists: (file) => file === ICO || file in links
  })
  return { shell, update }
}

describe('значок ярлыков под тему', () => {
  it('Хэллоуин ставит ярлыкам AbobaTV свой .ico, классика возвращает значок exe', () => {
    const links = {
      [START]: { target: EXE, icon: EXE, iconIndex: 0, appUserModelId: 'tv.aboba.desktop' },
      [DESKTOP]: { target: EXE, icon: EXE, iconIndex: 0 }
    }
    const { update } = setup(links)
    expect(update('halloween').updated).toEqual([START, DESKTOP])
    expect(links[START]).toEqual({ target: EXE, icon: ICO, iconIndex: 0, appUserModelId: 'tv.aboba.desktop' })
    expect(update('classic').updated).toEqual([START, DESKTOP])
    expect(links[DESKTOP]).toMatchObject({ icon: EXE, iconIndex: 0 })
  })

  it('не переписывает ярлык с нужным значком и не трогает чужие', () => {
    const other = 'C:\\Users\\u\\Desktop\\AbobaTV.lnk'
    const { update, shell } = setup({
      [START]: { target: EXE, icon: ICO, iconIndex: 0 },
      [other]: { target: 'C:\\Copy\\AbobaTV.exe', icon: 'C:\\Copy\\AbobaTV.exe', iconIndex: 0 }
    })
    expect(update('halloween')).toEqual({ updated: [], failed: [] })
    expect(shell.writeShortcutLink).not.toHaveBeenCalled()
  })

  it('ярлык без прав на запись пропускает и больше не дёргает', () => {
    const { update, shell } = setup({ [START]: { target: EXE, icon: EXE, iconIndex: 0 } }, [START])
    expect(update('halloween').failed).toEqual([START])
    expect(update('halloween').failed).toEqual([])
    expect(shell.writeShortcutLink).toHaveBeenCalledTimes(1)
  })

  it('без файла значка и с незнакомой темой ничего не меняет', () => {
    const shell = fakeShell({ [START]: { target: EXE, icon: EXE, iconIndex: 0 } })
    const update = createShortcutIcons({
      shell, paths: [START], halloweenIcon: ICO, ownsTarget: () => true, exists: (file) => file === START
    })
    expect(update('halloween').updated).toEqual([])
    expect(update('#fff').updated).toEqual([])
    expect(shell.writeShortcutLink).not.toHaveBeenCalled()
  })

  it('ищет ярлыки в «Пуске», на рабочих столах и на панели задач', () => {
    expect(shortcutPaths({ appData: 'C:\\R', desktop: 'C:\\D', publicDesktop: 'C:\\P\\Desktop', programData: 'C:\\PD' })).toEqual([
      'C:\\R\\Microsoft\\Windows\\Start Menu\\Programs\\AbobaTV.lnk',
      'C:\\PD\\Microsoft\\Windows\\Start Menu\\Programs\\AbobaTV.lnk',
      'C:\\D\\AbobaTV.lnk',
      'C:\\P\\Desktop\\AbobaTV.lnk',
      'C:\\R\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar\\AbobaTV.lnk'
    ])
  })
})
