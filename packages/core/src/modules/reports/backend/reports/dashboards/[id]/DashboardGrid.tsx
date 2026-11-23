"use client"

import * as React from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragMoveEvent,
} from '@dnd-kit/core'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { GripVertical, MoveDiagonal2 } from 'lucide-react'
import { clampRect, pixelDeltaToCells, placeTile, type GridRect, type GridTile } from './grid'

export type GridMetrics = { cols: number; rowHeight: number; gap: number }

type DashboardGridProps<T extends GridTile> = {
  tiles: readonly T[]
  grid: GridMetrics
  editing: boolean
  onLayoutChange: (tiles: T[]) => void
  renderTile: (tile: T, handles: { moveHandle: React.ReactNode }) => React.ReactNode
}

type DragPreview = { id: string; rect: GridRect }

function parseDragId(raw: string | number): { kind: 'move' | 'resize'; tileId: string } | null {
  const id = String(raw)
  if (id.startsWith('move:')) return { kind: 'move', tileId: id.slice(5) }
  if (id.startsWith('resize:')) return { kind: 'resize', tileId: id.slice(7) }
  return null
}

/**
 * Renders tiles at their stored 12-column `x/y/w/h`. In edit mode the tile
 * header handle moves a tile and the corner handle resizes it; positions snap
 * to grid cells while dragging and colliding tiles are pushed down.
 */
export function DashboardGrid<T extends GridTile>({ tiles, grid, editing, onLayoutChange, renderTile }: DashboardGridProps<T>) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = React.useState(0)
  const [preview, setPreview] = React.useState<DragPreview | null>(null)

  React.useEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  const colWidth = width > 0 ? (width - grid.gap * (grid.cols - 1)) / grid.cols : 0

  const handleDragMove = React.useCallback((event: DragMoveEvent) => {
    const parsed = parseDragId(event.active.id)
    if (!parsed) return
    const tile = tiles.find((candidate) => candidate.id === parsed.tileId)
    if (!tile) return
    const { dx, dy } = pixelDeltaToCells(event.delta, { colWidth, rowHeight: grid.rowHeight, gap: grid.gap })
    const rect = parsed.kind === 'move'
      ? { x: tile.x + dx, y: tile.y + dy, w: tile.w, h: tile.h }
      : { x: tile.x, y: tile.y, w: tile.w + dx, h: tile.h + dy }
    setPreview({ id: tile.id, rect: clampRect(rect, grid.cols) })
  }, [colWidth, grid.cols, grid.gap, grid.rowHeight, tiles])

  const handleDragEnd = React.useCallback(() => {
    if (preview) onLayoutChange(placeTile(tiles, preview.id, preview.rect, grid.cols))
    setPreview(null)
  }, [grid.cols, onLayoutChange, preview, tiles])

  const displayTiles = React.useMemo(
    () => (preview ? placeTile(tiles, preview.id, preview.rect, grid.cols) : [...tiles]),
    [grid.cols, preview, tiles],
  )

  return (
    <DndContext sensors={sensors} onDragMove={handleDragMove} onDragEnd={handleDragEnd} onDragCancel={() => setPreview(null)}>
      <div
        ref={containerRef}
        className="flex flex-col md:grid"
        style={{
          gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
          gridAutoRows: `${grid.rowHeight}px`,
          gap: `${grid.gap}px`,
        }}
      >
        {displayTiles.map((tile) => (
          <GridCell
            key={tile.id}
            tile={tile}
            editing={editing}
            dragging={preview?.id === tile.id}
            rowHeight={grid.rowHeight}
            gap={grid.gap}
            renderTile={renderTile}
          />
        ))}
      </div>
    </DndContext>
  )
}

type GridCellProps<T extends GridTile> = {
  tile: T
  editing: boolean
  dragging: boolean
  rowHeight: number
  gap: number
  renderTile: DashboardGridProps<T>['renderTile']
}

function GridCell<T extends GridTile>({ tile, editing, dragging, rowHeight, gap, renderTile }: GridCellProps<T>) {
  const t = useT()
  const move = useDraggable({ id: `move:${tile.id}`, disabled: !editing })
  const resize = useDraggable({ id: `resize:${tile.id}`, disabled: !editing })

  const moveHandle = editing ? (
    <IconButton
      ref={move.setNodeRef}
      variant="ghost"
      size="xs"
      className="cursor-grab touch-none active:cursor-grabbing"
      aria-label={t('reports.dashboards.detail.tiles.moveHandle', 'Drag to move')}
      {...move.attributes}
      {...move.listeners}
    >
      <GripVertical className="size-4 text-muted-foreground" aria-hidden />
    </IconButton>
  ) : null

  return (
    <div
      className={dragging ? 'relative opacity-80 ring-2 ring-ring rounded-md' : 'relative'}
      style={{
        gridColumn: `${tile.x + 1} / span ${tile.w}`,
        gridRow: `${tile.y + 1} / span ${tile.h}`,
        minHeight: `${tile.h * rowHeight + (tile.h - 1) * gap}px`,
      }}
      data-tile-id={tile.id}
    >
      {renderTile(tile, { moveHandle })}
      {editing ? (
        <IconButton
          ref={resize.setNodeRef}
          variant="ghost"
          size="xs"
          className="absolute bottom-1 right-1 cursor-nwse-resize touch-none"
          aria-label={t('reports.dashboards.detail.tiles.resizeHandle', 'Drag to resize')}
          {...resize.attributes}
          {...resize.listeners}
        >
          <MoveDiagonal2 className="size-3.5 text-muted-foreground" aria-hidden />
        </IconButton>
      ) : null}
    </div>
  )
}

