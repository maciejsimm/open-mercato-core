/**
 * Pure helpers for the dashboard 12-column grid (spec F16). Tiles carry
 * `x/y/w/h` in grid cells; moving or resizing one tile pushes any tile it
 * now overlaps down until nothing collides.
 */

export type GridRect = { x: number; y: number; w: number; h: number }

export type GridTile = GridRect & { id: string }

export const MAX_TILE_HEIGHT = 96
export const DEFAULT_TILE_SIZE = { w: 4, h: 4 } as const

export function clampRect(rect: GridRect, cols: number): GridRect {
  const w = Math.min(Math.max(1, Math.round(rect.w)), cols)
  const h = Math.min(Math.max(1, Math.round(rect.h)), MAX_TILE_HEIGHT)
  const x = Math.min(Math.max(0, Math.round(rect.x)), cols - w)
  const y = Math.max(0, Math.round(rect.y))
  return { x, y, w, h }
}

export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Put tile `id` at `rect` and push colliding tiles down. Tiles are resolved
 * top-to-bottom so the result is deterministic.
 */
export function placeTile<T extends GridTile>(tiles: readonly T[], id: string, rect: GridRect, cols: number): T[] {
  const target = tiles.find((tile) => tile.id === id)
  if (!target) return [...tiles]
  const moved = { ...target, ...clampRect(rect, cols) }
  const placed: T[] = [moved]
  const others = tiles
    .filter((tile) => tile.id !== id)
    .map((tile) => ({ ...tile, ...clampRect(tile, cols) }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  for (const tile of others) {
    const next = { ...tile }
    let collision = placed.find((other) => rectsOverlap(other, next))
    while (collision) {
      next.y = collision.y + collision.h
      collision = placed.find((other) => rectsOverlap(other, next))
    }
    placed.push(next)
  }
  const byId = new Map(placed.map((tile) => [tile.id, tile]))
  return tiles.map((tile) => byId.get(tile.id) ?? tile)
}

/** First free top-left slot for a `w × h` tile, scanning row by row. */
export function findFreeSlot(tiles: readonly GridRect[], size: { w: number; h: number }, cols: number): GridRect {
  const w = Math.min(size.w, cols)
  const bottom = tiles.reduce((max, tile) => Math.max(max, tile.y + tile.h), 0)
  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x + w <= cols; x += 1) {
      const candidate = { x, y, w, h: size.h }
      if (!tiles.some((tile) => rectsOverlap(tile, candidate))) return candidate
    }
  }
  return { x: 0, y: bottom, w, h: size.h }
}

/** Convert a pointer delta in pixels into whole grid cells. */
export function pixelDeltaToCells(
  delta: { x: number; y: number },
  metrics: { colWidth: number; rowHeight: number; gap: number },
): { dx: number; dy: number } {
  const colStep = metrics.colWidth + metrics.gap
  const rowStep = metrics.rowHeight + metrics.gap
  return {
    dx: colStep > 0 ? Math.round(delta.x / colStep) : 0,
    dy: rowStep > 0 ? Math.round(delta.y / rowStep) : 0,
  }
}

/** Number of grid rows the layout occupies. */
export function gridRowCount(tiles: readonly GridRect[]): number {
  return tiles.reduce((max, tile) => Math.max(max, tile.y + tile.h), 0)
}
