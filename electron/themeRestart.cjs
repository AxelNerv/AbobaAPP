// The caller is guarded by main.cjs's trusted main-frame IPC wrapper.
const createThemeRestart = ({ app, isBusy, beforeQuit, schedule = setTimeout }) => {
  let pending = false
  return () => {
    if (isBusy()) return { ok: false, error: 'Дождитесь завершения текущей операции.' }
    if (pending) return { ok: true }
    app.relaunch()
    pending = true
    schedule(() => { beforeQuit(); app.quit() }, 200)
    return { ok: true }
  }
}
module.exports = { createThemeRestart }
