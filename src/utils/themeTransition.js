// Persist synchronously before asking the native process to stop. No arbitrary
// command-line arguments or executable paths cross the preload bridge.
export const applyThemeAndRestart = async (theme, id, api, reload) => {
  const previous = theme.theme
  try {
    theme.setTheme(id)
    localStorage.setItem('aboba-theme', JSON.stringify({ theme: theme.theme,
      accent: theme.accent, customColor: theme.customColor, background: theme.background }))
    if (api) {
      if (typeof api.restartForTheme !== 'function') throw new Error('Для перезапуска нужна новая сборка приложения.')
      const result = await api.restartForTheme()
      if (result?.ok !== true) throw new Error(result?.error || 'Приложение не подтвердило перезапуск.')
    } else reload()
  } catch (error) {
    theme.setTheme(previous)
    try {
      localStorage.setItem('aboba-theme', JSON.stringify({ theme: previous,
        accent: theme.accent, customColor: theme.customColor, background: theme.background }))
    } catch (storageError) { console.error('[theme] не удалось восстановить настройки:', storageError) }
    throw error
  }
}
