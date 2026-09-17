import { describe, expect, it } from 'vitest'
import { pickNext } from './useSpatialNavigation'

const rect = (left, top, width = 100, height = 40) => ({ left, top, right: left + width, bottom: top + height })

describe('pickNext — выбор соседа стрелкой', () => {
  // Ряд кнопок над плеером и кнопка под ним:
  //  [A][B][C]
  //  [    D   ]
  const A = rect(0, 0)
  const B = rect(120, 0)
  const C = rect(240, 0)
  const D = rect(0, 100, 340)

  it('вправо и влево — соседняя кнопка в ряду', () => {
    expect(pickNext(A, [B, C, D], 'right')).toBe(0)
    expect(pickNext(C, [A, B, D], 'left')).toBe(1)
  })

  it('вниз — элемент под текущим, вверх — обратно', () => {
    expect(pickNext(B, [A, C, D], 'down')).toBe(2)
    expect(pickNext(D, [A, B, C], 'up')).toBe(0)
  })

  it('на одной линии предпочтительнее, чем ближе, но наискосок', () => {
    const current = rect(0, 0)
    const sameRowFar = rect(400, 0)
    const diagonalNear = rect(130, 60)
    expect(pickNext(current, [diagonalNear, sameRowFar], 'right')).toBe(1)
  })

  it('в пустую сторону — никого', () => {
    expect(pickNext(A, [B, C, D], 'left')).toBe(-1)
    expect(pickNext(A, [B, C, D], 'up')).toBe(-1)
  })

  it('боковая панель слева достижима из содержимого', () => {
    const sidebarItem = rect(8, 110, 44, 42)
    const firstButton = rect(160, 100)
    const secondButton = rect(280, 100)
    expect(pickNext(firstButton, [sidebarItem, secondButton], 'left')).toBe(0)
  })
})
