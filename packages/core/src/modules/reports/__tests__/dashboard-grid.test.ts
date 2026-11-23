import {
  clampRect,
  findFreeSlot,
  gridRowCount,
  pixelDeltaToCells,
  placeTile,
  rectsOverlap,
} from '../backend/reports/dashboards/[id]/grid'

describe('dashboard grid helpers', () => {
  it('clamps a rect into the grid', () => {
    expect(clampRect({ x: 10, y: -2, w: 6, h: 0 }, 12)).toEqual({ x: 6, y: 0, w: 6, h: 1 })
    expect(clampRect({ x: 0, y: 0, w: 20, h: 4 }, 12)).toEqual({ x: 0, y: 0, w: 12, h: 4 })
  })

  it('detects overlap only when cells are shared', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 4, h: 4 }, { x: 4, y: 0, w: 4, h: 4 })).toBe(false)
    expect(rectsOverlap({ x: 0, y: 0, w: 4, h: 4 }, { x: 3, y: 3, w: 2, h: 2 })).toBe(true)
  })

  it('pushes colliding tiles down when a tile moves onto them', () => {
    const tiles = [
      { id: 'a', x: 0, y: 0, w: 6, h: 4 },
      { id: 'b', x: 6, y: 0, w: 6, h: 4 },
      { id: 'c', x: 6, y: 4, w: 6, h: 2 },
    ]
    const next = placeTile(tiles, 'a', { x: 6, y: 0, w: 6, h: 4 }, 12)
    expect(next.find((tile) => tile.id === 'a')).toMatchObject({ x: 6, y: 0 })
    expect(next.find((tile) => tile.id === 'b')).toMatchObject({ x: 6, y: 4 })
    expect(next.find((tile) => tile.id === 'c')).toMatchObject({ x: 6, y: 8 })
    for (const tile of next) {
      for (const other of next) {
        if (tile.id !== other.id) expect(rectsOverlap(tile, other)).toBe(false)
      }
    }
  })

  it('keeps tile order and leaves unknown ids untouched', () => {
    const tiles = [{ id: 'a', x: 0, y: 0, w: 4, h: 4 }]
    expect(placeTile(tiles, 'missing', { x: 1, y: 1, w: 1, h: 1 }, 12)).toEqual(tiles)
  })

  it('finds the first free slot for a new tile', () => {
    const tiles = [{ x: 0, y: 0, w: 8, h: 4 }]
    expect(findFreeSlot(tiles, { w: 4, h: 4 }, 12)).toEqual({ x: 8, y: 0, w: 4, h: 4 })
    expect(findFreeSlot([{ x: 0, y: 0, w: 12, h: 2 }], { w: 4, h: 4 }, 12)).toEqual({ x: 0, y: 2, w: 4, h: 4 })
  })

  it('converts a pixel delta into grid cells', () => {
    expect(pixelDeltaToCells({ x: 190, y: -95 }, { colWidth: 80, rowHeight: 80, gap: 8 })).toEqual({ dx: 2, dy: -1 })
  })

  it('counts occupied rows', () => {
    expect(gridRowCount([{ x: 0, y: 2, w: 1, h: 3 }, { x: 0, y: 0, w: 1, h: 1 }])).toBe(5)
  })
})
