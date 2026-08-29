// Sculpt-mode helpers that are pure enough to test without a canvas: sizing the
// field to a site, resolving the flatten target, and the commit.
//
// The tool component owns pointer plumbing; everything here is a function of
// data, which is what lets the interesting decisions (grid extent, undo
// granularity, when a stroke is worth persisting) be asserted in unit tests
// instead of e2e.

import {
  type AnyNode,
  type AnyNodeId,
  type BrushSettings,
  type BuildingNode,
  commitTerrainField,
  createTerrainField,
  DEFAULT_TERRAIN_SPACING,
  getLevelElevations,
  type HeightPatch,
  isDatumField,
  minBrushRadius,
  persistedTerrainFieldOf,
  pointInPolygon2D,
  quantize,
  runAsSingleSceneHistoryStep,
  type SiteNode,
  type SlabNode,
  sampleTarget,
  type TerrainField,
  type TerrainVerb,
  useLiveTerrain,
  useScene,
} from '@pascal-app/core'

/**
 * Field sizes we allow, all `2ⁿ+1` so a future LOD halving lands on existing
 * samples instead of interpolating a seam.
 */
const FIELD_SIZES = [33, 65, 129, 257] as const

/**
 * Sample count a fresh field gets, chosen to cover the site polygon at roughly
 * `DEFAULT_TERRAIN_SPACING` and never exceeding 257² (66 049 samples — about
 * four furnished rooms' worth of vertices).
 *
 * Sizing from the polygon rather than a fixed extent matters because the extent
 * is baked at creation: the field is the ground for the whole session, and a
 * grid that stops short of the lot line leaves a visible cliff where the terrain
 * mesh ends and the flat fill resumes. Padding by one spacing keeps the boundary
 * line itself on interpolated ground rather than on the clamped edge row.
 */
export function fieldExtentForSite(site: Pick<SiteNode, 'polygon'> | null | undefined): {
  origin: [number, number]
  cols: number
  rows: number
  spacing: number
} {
  const points = site?.polygon?.points ?? []
  if (points.length < 3) {
    const half = ((65 - 1) / 2) * DEFAULT_TERRAIN_SPACING
    return { origin: [-half, -half], cols: 65, rows: 65, spacing: DEFAULT_TERRAIN_SPACING }
  }

  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }

  // The grid is square: a rectangular field would need two spacings or two
  // sample counts, and both make every downstream index calculation branchier
  // for no visual gain.
  const pad = DEFAULT_TERRAIN_SPACING * 2
  const span = Math.max(maxX - minX, maxZ - minZ) + pad * 2
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2

  const wanted = Math.ceil(span / DEFAULT_TERRAIN_SPACING) + 1
  const size = FIELD_SIZES.find((candidate) => candidate >= wanted) ?? FIELD_SIZES.at(-1)!
  // Spacing stretches when the lot is bigger than 257 samples can cover at the
  // default: coarser ground beats ground that stops at the property line.
  const spacing = Math.max(DEFAULT_TERRAIN_SPACING, span / (size - 1))
  const half = ((size - 1) / 2) * spacing

  return {
    origin: [centerX - half, centerZ - half],
    cols: size,
    rows: size,
    spacing,
  }
}

/**
 * The field a sculpt stroke on `site` should start from: its existing terrain,
 * or a fresh flat one sized to the lot.
 *
 * Not `terrainFieldForEdit` — that takes explicit options, and the whole point
 * here is that the tool must not have to know how to size a grid.
 */
export function sculptFieldForSite(site: SiteNode): TerrainField {
  return persistedTerrainFieldOf(site) ?? createTerrainField(fieldExtentForSite(site))
}

/** Whether an XZ point belongs to the editable property footprint. */
export function terrainPointInsideSite(
  site: Pick<SiteNode, 'polygon'>,
  x: number,
  z: number,
): boolean {
  const polygon = site.polygon?.points ?? []
  return polygon.length >= 3 && pointInPolygon2D([x, z], polygon, { includeBoundary: true })
}

/**
 * Keep a rectangular brush patch inside the property footprint.
 *
 * The heightfield stays padded and square for compact storage and predictable
 * partial uploads, but that implementation extent is not editable land. Samples
 * outside the polygon retain their current values even when a brush overlaps the
 * property line.
 */
export function clipTerrainPatchToSite(
  field: TerrainField,
  patch: HeightPatch,
  site: Pick<SiteNode, 'polygon'>,
): HeightPatch {
  let heights: Int16Array | null = null

  for (let row = 0; row < patch.rows; row += 1) {
    for (let col = 0; col < patch.cols; col += 1) {
      const fieldCol = patch.col0 + col
      const fieldRow = patch.row0 + row
      const x = field.origin[0] + fieldCol * field.spacing
      const z = field.origin[1] + fieldRow * field.spacing
      if (terrainPointInsideSite(site, x, z)) continue

      const patchIndex = row * patch.cols + col
      const previous = field.heights[fieldRow * field.cols + fieldCol] ?? 0
      if ((patch.heights[patchIndex] ?? 0) === previous) continue
      heights ??= patch.heights.slice()
      heights[patchIndex] = previous
    }
  }

  return heights ? { ...patch, heights } : patch
}

/**
 * The site node the sculpt tool acts on, read straight from the scene.
 *
 * The tool and panel get this from a subscribed selector; the keyboard handler
 * cannot (it is one imperative listener, not a component), and open-coding
 * "root[0], is it a site?" a third time is how the three drift apart.
 */
export function activeSiteNode(): SiteNode | null {
  const { nodes, rootNodeIds } = useScene.getState()
  const root = rootNodeIds[0]
  const node = root ? nodes[root] : undefined
  return node?.type === 'site' ? (node as SiteNode) : null
}

/**
 * Largest brush radius offered, in metres.
 *
 * A taste call, unlike the minimum: 20 m covers a building pad in one pass and is
 * about where a bigger brush stops being aimable and starts being `flattenSite`.
 */
export const MAX_BRUSH_RADIUS = 20

/**
 * The legal brush-radius range for `site`, low end first.
 *
 * Exists because two controls set this value — the panel's Size slider and the
 * `[`/`]` keys — and both used to carry their own hardcoded `0.5`/`20`, with a
 * comment in the keyboard handler asserting they matched. They did, but nothing
 * held them to it, and the shared minimum was wrong anyway: it was a flat 0.5 m
 * while the real floor scales with the field's spacing, which
 * `fieldExtentForSite` stretches on large lots. Below that floor a drag paints
 * nothing at all (see `MIN_BRUSH_RADIUS_IN_SPACINGS`).
 *
 * The max is clamped to stay above the min so the range never inverts on a lot
 * big enough that the minimum passes 20 m — the brush ends up pinned to one
 * usable size, which is honest, rather than to an empty range.
 */
export function brushRadiusRange(site: SiteNode | null | undefined): [number, number] {
  // Spacing, not the field: this runs on every render of the panel, and
  // `sculptFieldForSite` would decode or allocate up to 257² samples to read one
  // number off the result. An existing field's spacing is on the node; a lot with
  // no terrain yet gets the spacing it *would* be given.
  const spacing = site
    ? (site.terrain?.spacing ?? fieldExtentForSite(site).spacing)
    : DEFAULT_TERRAIN_SPACING
  const min = minBrushRadius({ spacing })
  return [min, Math.max(min, MAX_BRUSH_RADIUS)]
}

/** `radius` clamped into `brushRadiusRange(site)`. */
export function clampBrushRadius(site: SiteNode | null | undefined, radius: number): number {
  const [min, max] = brushRadiusRange(site)
  return Math.min(max, Math.max(min, radius))
}

/**
 * The absolute height a `flatten` stroke aims at.
 *
 * `null` target means the user never picked one, so the first click samples the
 * ground under the cursor — flatten stays usable without ever opening a number
 * field, and "flatten this pad to match that corner" is a two-step gesture.
 */
export function resolveFlattenTarget(
  field: TerrainField,
  explicitTarget: number | null,
  x: number,
  z: number,
): number {
  return explicitTarget ?? sampleTarget(field, x, z)
}

export type SculptCommit = {
  verb: TerrainVerb
  settings: BrushSettings
}

/**
 * Drop any stroke in flight on `site` before a write that replaces the whole field.
 *
 * Every reader prefers the live stroke over the persisted terrain (that is what
 * makes a drag consistent), so a lot-wide write landing *under* a live stroke is
 * invisible: the ground keeps showing the stroke, and the stroke's own commit —
 * computed from a snapshot taken before the write — then overwrites it. The user
 * sees a button that did nothing, with no error and nothing in history to undo.
 *
 * Reachable because the brush and these controls are usable at the same moment.
 * On touch it takes no timing at all: one finger holds a stroke while the other
 * taps the panel. With a mouse a stroke stays live across a wheel zoom's 500 ms
 * `cameraDragging` window, and a held pointer that leaves the canvas keeps its
 * capture until release.
 *
 * Abandoning rather than committing first: the pending dabs are the thing the
 * user is replacing, so keeping them would mean "level the lot, except where I
 * happened to be mid-drag". Ending the live stroke without committing reverts it
 * exactly, the same as Escape.
 */
function abandonLiveStroke(site: Pick<SiteNode, 'id'>): void {
  useLiveTerrain.getState().end(site.id)
}

/**
 * Flatten the whole site to one height in a single step.
 *
 * The brush cannot do this well and should not have to: covering a lot with dabs
 * is dozens of strokes, and any sample the brush misses leaves a ridge that is
 * invisible until a slab lands on it. Sizing from `fieldExtentForSite` means the
 * result covers the padded extent, so the property line stays on flat ground too.
 */
export function flattenSite(site: SiteNode, metres: number): void {
  abandonLiveStroke(site)
  const field = sculptFieldForSite(site)
  const value = quantize(field, metres)
  const heights = new Int16Array(field.heights.length)
  heights.fill(value)
  commitStroke(site.id, { ...field, heights })
}

/**
 * Drop a site's terrain entirely, back to the implicit flat ground.
 *
 * Distinct from flattening to 0: this removes the `terrain` field, so the scene
 * returns to the exact state it had before terrain was ever touched rather than
 * carrying a field of zeroes. Undo-able like any other sculpt.
 */
export function resetSiteTerrain(site: SiteNode): void {
  // Before the `site.terrain` guard, not after: a stroke on a site that has no
  // persisted terrain yet is exactly the case that reaches the early return, and
  // leaving it live would keep showing sculpted ground the scene graph has none of.
  abandonLiveStroke(site)
  if (!site.terrain) return
  runAsSingleSceneHistoryStep(useScene, () => {
    useScene.getState().updateNode(site.id, { terrain: undefined })
  })
}

type Point2D = [number, number]

/**
 * Excavate the terrain beneath all building slabs across the scene to match their
 * underside elevations, carving building footprints and basements in a single step.
 */
export function excavateSiteToModel(site: SiteNode, nodes: Record<string, AnyNode>): void {
  abandonLiveStroke(site)
  const targets = collectSlabExcavationTargets(nodes)
  if (targets.length === 0) return

  const field = sculptFieldForSite(site)
  const heights = new Int16Array(field.heights)
  let changed = false

  for (let r = 0; r < field.rows; r++) {
    const z = field.origin[1] + r * field.spacing
    for (let c = 0; c < field.cols; c++) {
      const x = field.origin[0] + c * field.spacing

      if (!terrainPointInsideSite(site, x, z)) continue

      let minTargetY: number | null = null
      for (const target of targets) {
        if (x < target.minX || x > target.maxX || z < target.minZ || z > target.maxZ) {
          continue
        }
        if (pointInPolygon2D([x, z], target.polygon, { includeBoundary: true })) {
          const targetY = target.getWorldBaseY(x, z)
          if (minTargetY === null || targetY < minTargetY) {
            minTargetY = targetY
          }
        }
      }

      if (minTargetY !== null) {
        const idx = r * field.cols + c
        const currentHeightMetres = heights[idx]! * field.step
        if (currentHeightMetres > minTargetY) {
          heights[idx] = quantize(field, minTargetY)
          changed = true
        }
      }
    }
  }

  if (changed) {
    commitStroke(site.id, { ...field, heights })
  }
}

type SlabExcavationTarget = {
  polygon: Point2D[]
  getWorldBaseY: (wx: number, wz: number) => number
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

function collectSlabExcavationTargets(nodes: Record<string, AnyNode>): SlabExcavationTarget[] {
  const targets: SlabExcavationTarget[] = []
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)

  const buildings = Object.values(nodes).filter(
    (n): n is BuildingNode => n?.type === 'building',
  )

  for (const node of Object.values(nodes)) {
    if (node?.type !== 'slab') continue
    const slab = node as SlabNode
    const points: Point2D[] = Array.isArray(slab.polygon)
      ? (slab.polygon as Point2D[])
      : ((slab.polygon as unknown as { points?: Point2D[] })?.points ?? [])
    if (points.length < 3) continue

    const levelId = slab.parentId
    const levelElevation = levelId ? elevations.get(levelId) : undefined
    const levelBaseY = levelElevation?.baseY ?? 0

    const buildingId = levelElevation?.buildingId ?? null
    const building = buildingId
      ? (nodes[buildingId] as BuildingNode | undefined)
      : buildings.find(
          (b) =>
            (b.children as string[] | undefined)?.includes(slab.id) ||
            (levelId && (b.children as string[] | undefined)?.includes(levelId)),
        )

    const bPos = building?.position ?? [0, 0, 0]
    const bRotY = building?.rotation?.[1] ?? 0

    const slabElevation = slab.elevation ?? 0.05
    const slabThickness = slab.thickness ?? 0.05
    const baseLocalY = slabElevation - slabThickness
    const worldLevelBaseY = (bPos[1] ?? 0) + levelBaseY

    const slopeAngleDeg = slab.slopeAngle ?? 0
    const slopeDirDeg = slab.slopeDirection ?? 0
    const isSloped = Math.abs(slopeAngleDeg) > 1e-4

    let slopeUx = 1
    let slopeUz = 0
    let tanSlope = 0
    let minSlopeProj = 0

    if (isSloped) {
      const slopeAngleRad = (slopeAngleDeg * Math.PI) / 180
      const slopeDirRad = (slopeDirDeg * Math.PI) / 180
      slopeUx = Math.cos(slopeDirRad)
      slopeUz = Math.sin(slopeDirRad)
      tanSlope = Math.tan(slopeAngleRad)

      minSlopeProj = Number.POSITIVE_INFINITY
      for (const [px, pz] of points) {
        const proj = px * slopeUx + pz * slopeUz
        if (proj < minSlopeProj) minSlopeProj = proj
      }
    }

    const cos = Math.cos(bRotY)
    const sin = Math.sin(bRotY)
    const px = bPos[0] ?? 0
    const pz = bPos[2] ?? 0

    const worldPolygon: Point2D[] = points.map(([x, z]) => {
      if (bRotY === 0) return [x + px, z + pz]
      return [cos * x + sin * z + px, -sin * x + cos * z + pz]
    })

    let minX = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    for (const [wx, wz] of worldPolygon) {
      if (wx < minX) minX = wx
      if (wx > maxX) maxX = wx
      if (wz < minZ) minZ = wz
      if (wz > maxZ) maxZ = wz
    }

    const getWorldBaseY = (wx: number, wz: number): number => {
      if (!isSloped) return worldLevelBaseY + baseLocalY
      const dx = wx - px
      const dz = wz - pz
      const lx = bRotY === 0 ? dx : cos * dx - sin * dz
      const lz = bRotY === 0 ? dz : sin * dx + cos * dz
      const dist = lx * slopeUx + lz * slopeUz - minSlopeProj
      return worldLevelBaseY + baseLocalY + dist * tanSlope
    }

    targets.push({
      polygon: worldPolygon,
      getWorldBaseY,
      minX,
      minZ,
      maxX,
      maxZ,
    })
  }

  return targets
}

/**
 * Persist a finished stroke as exactly one undo step.
 *
 * `runAsSingleSceneHistoryStep` collapses the write, which matters because a
 * stroke is one user action even though it produced dozens of dabs — without it,
 * undo would walk back through the stroke dab by dab, which is both surprising
 * and unbounded in length.
 *
 * A stroke that leaves the field at the datum writes `undefined` rather than
 * ~11 KB of base64 zeroes: sculpting up and then flattening back down should
 * return the scene to the state it would have had if terrain were never touched,
 * not merely to a visually identical one.
 */
export function commitStroke(siteId: SiteNode['id'], field: TerrainField): void {
  runAsSingleSceneHistoryStep(useScene, () => {
    useScene.getState().updateNode(siteId, {
      terrain: isDatumField(field) ? undefined : commitTerrainField(field),
    })
  })
}

