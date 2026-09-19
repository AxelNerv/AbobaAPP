export const createLatestRequestGuard = () => {
  let currentRequest = 0

  return {
    begin() {
      currentRequest += 1
      return currentRequest
    },
    isCurrent(request) {
      return request === currentRequest
    },
    invalidate() {
      currentRequest += 1
    }
  }
}
