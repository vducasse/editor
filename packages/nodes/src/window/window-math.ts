import type { AnyNode, AnyNodeId, WallNode } from '@pascal-app/core'
import { readHostWallCeiling } from '../shared/wall-opening-ceiling'

/**
 * Default sill height (metres from the floor to the BOTTOM of a window) for a
 * fresh window that has no wall-face height yet — the off-wall ghost and the
 * floor-cursor placement use it so a new window floats slightly above the
 * ground rather than sitting on it. The committed Y is the window's CENTRE, so
 * callers add `height / 2`. An existing window keeps its own sill.
 */
export const DEFAULT_WINDOW_SILL_M = 0.5

/**
 * Converts wall-local (X along wall, Y = height above wall base) to world XYZ.
 * Wall XZ uses level-local coordinates (levels only offset in Y, not XZ).
 * Pass levelYOffset (the level group's current world Y) and slabElevation (the
 * wall mesh's Y within the level group) so the cursor lands at the correct world
 * height — matching how WallSystem positions the wall mesh at slabElevation.
 */
export function wallLocalToWorld(
  wallNode: WallNode,
  localX: number,
  localY: number,
  levelYOffset = 0,
  slabElevation = 0,
): [number, number, number] {
  const wallAngle = Math.atan2(
    wallNode.end[1] - wallNode.start[1],
    wallNode.end[0] - wallNode.start[0],
  )
  return [
    wallNode.start[0] + localX * Math.cos(wallAngle),
    slabElevation + localY + levelYOffset,
    wallNode.start[1] + localX * Math.sin(wallAngle),
  ]
}

/**
 * Clamps window center position so it stays fully within wall bounds. The Y
 * ceiling is the wall's RESOLVED top (storey plane for plane-bound walls,
 * stored height for explicit ones, minus the elected slab base) — `nodes` is
 * required because a plane-bound wall's top lives on its level, not on the
 * wall record.
 */
export function clampToWall(
  wallNode: WallNode,
  localX: number,
  localY: number,
  width: number,
  height: number,
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
): { clampedX: number; clampedY: number; fits: boolean } {
  const dx = wallNode.end[0] - wallNode.start[0]
  const dz = wallNode.end[1] - wallNode.start[1]
  const wallLength = Math.hypot(dx, dz)

  const minX = width / 2
  const maxX = wallLength - width / 2

  const sceneReader = {
    get: (id: AnyNodeId) => nodes[id],
    nodes: () => nodes,
  }

  function checkFits(testX: number, testY: number) {
    const leftHeight = readHostWallCeiling(wallNode.id, sceneReader, testX - width / 2)
    const rightHeight = readHostWallCeiling(wallNode.id, sceneReader, testX + width / 2)
    const topY = testY + height / 2
    return leftHeight >= topY && rightHeight >= topY
  }

  let clampedX = Math.max(minX, Math.min(maxX, localX))
  const leftCeiling = readHostWallCeiling(wallNode.id, sceneReader, clampedX - width / 2)
  const rightCeiling = readHostWallCeiling(wallNode.id, sceneReader, clampedX + width / 2)
  const localCeiling = Math.min(leftCeiling, rightCeiling)
  const clampedYRaw = Math.max(height / 2, Math.min(localCeiling - height / 2, localY))
  
  let clampedY = clampedYRaw

  if (width > wallLength) {
    return { clampedX, clampedY, fits: false }
  }

  let fits = checkFits(clampedX, clampedY)

  if (!fits) {
    // If it doesn't fit horizontally, try sliding down first
    const lowestY = height / 2
    if (clampedY > lowestY) {
      // Find maximum Y that fits at current X
      let lowY = lowestY
      let highY = clampedY
      for (let i = 0; i < 15; i++) {
        const mid = (lowY + highY) / 2
        if (checkFits(clampedX, mid)) {
          lowY = mid
        } else {
          highY = mid
        }
      }
      if (checkFits(clampedX, lowY)) {
        clampedY = lowY
        fits = true
      }
    }

    if (!fits) {
      // Try sliding left/right by steps up to width/2
      const step = 0.1
      for (let offset = step; offset <= width / 2; offset += step) {
        if (clampedX - offset >= minX && checkFits(clampedX - offset, clampedY)) {
          clampedX -= offset
          fits = true
          break
        }
        if (clampedX + offset <= maxX && checkFits(clampedX + offset, clampedY)) {
          clampedX += offset
          fits = true
          break
        }
      }
    }
  }

  return { clampedX, clampedY, fits }
}

/**
 * Wall-child overlap is shared by door + window placement (one source of
 * truth in `shared/wall-attach-target.ts`). Re-exported here so existing
 * `./window-math` importers don't change.
 */
export { hasWallChildOverlap } from '../shared/wall-attach-target'
