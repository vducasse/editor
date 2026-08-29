import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createTerrainField,
  DEFAULT_TERRAIN_SPACING,
  heightAt,
  minBrushRadius,
  type SiteNode,
  terrainFieldOf,
  useLiveTerrain,
  useScene,
} from '@pascal-app/core'
import {
  brushRadiusRange,
  clampBrushRadius,
  clipTerrainPatchToSite,
  excavateSiteToModel,
  fieldExtentForSite,
  flattenSite,
  resetSiteTerrain,
  resolveFlattenTarget,
  sculptFieldForSite,
  terrainPointInsideSite,
} from './terrain-sculpt'

// `updateNode` batches its dirty-node flush through rAF, which bun's runtime does
// not provide. Running the callback synchronously is what the other scene-writing
// unit tests do (`handle-drag-history.test.ts`).
type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

function site(points: Array<[number, number]>): SiteNode {
  return {
    id: 'site_1',
    type: 'site',
    children: [],
    polygon: { type: 'polygon', points },
  } as unknown as SiteNode
}

describe('fieldExtentForSite', () => {
  test('covers the whole polygon with padding to spare', () => {
    const extent = fieldExtentForSite(
      site([
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ]),
    )
    const maxX = extent.origin[0] + (extent.cols - 1) * extent.spacing
    const maxZ = extent.origin[1] + (extent.rows - 1) * extent.spacing

    // Strictly outside the lot on all four sides: the field must not end at the
    // property line, or the terrain mesh stops exactly where the boundary is
    // drawn and leaves a visible cliff.
    expect(extent.origin[0]).toBeLessThan(-10)
    expect(extent.origin[1]).toBeLessThan(-10)
    expect(maxX).toBeGreaterThan(10)
    expect(maxZ).toBeGreaterThan(10)
  })

  test('is square and 2ⁿ+1 so a future LOD halving lands on real samples', () => {
    for (const half of [4, 12, 30, 80]) {
      const extent = fieldExtentForSite(
        site([
          [-half, -half],
          [half, -half],
          [half, half],
          [-half, half],
        ]),
      )
      expect(extent.cols).toBe(extent.rows)
      expect([33, 65, 129, 257]).toContain(extent.cols)
    }
  })

  test('centres on the lot even when the lot is off-origin', () => {
    const extent = fieldExtentForSite(
      site([
        [100, 40],
        [120, 40],
        [120, 60],
        [100, 60],
      ]),
    )
    const centerX = extent.origin[0] + ((extent.cols - 1) / 2) * extent.spacing
    const centerZ = extent.origin[1] + ((extent.rows - 1) / 2) * extent.spacing
    expect(centerX).toBeCloseTo(110, 6)
    expect(centerZ).toBeCloseTo(50, 6)
  })

  test('holds the default spacing while the lot fits in 257 samples', () => {
    const extent = fieldExtentForSite(
      site([
        [-20, -20],
        [20, -20],
        [20, 20],
        [-20, 20],
      ]),
    )
    expect(extent.spacing).toBeCloseTo(DEFAULT_TERRAIN_SPACING, 6)
  })

  test('stretches spacing rather than stopping short on a huge lot', () => {
    // A 400 m lot needs 801 samples at 0.5 m. Capping the sample count and
    // coarsening is the right trade: coarse ground everywhere beats fine ground
    // that ends mid-lot.
    const extent = fieldExtentForSite(
      site([
        [-200, -200],
        [200, -200],
        [200, 200],
        [-200, 200],
      ]),
    )
    expect(extent.cols).toBe(257)
    expect(extent.spacing).toBeGreaterThan(DEFAULT_TERRAIN_SPACING)
    const maxX = extent.origin[0] + (extent.cols - 1) * extent.spacing
    expect(maxX).toBeGreaterThan(200)
  })

  test('a degenerate polygon still yields a usable field', () => {
    for (const points of [[], [[0, 0]] as Array<[number, number]>]) {
      const extent = fieldExtentForSite(site(points as Array<[number, number]>))
      expect(extent.cols).toBe(65)
      expect(extent.spacing).toBeCloseTo(DEFAULT_TERRAIN_SPACING, 6)
    }
  })

  test('a null site does not throw', () => {
    expect(fieldExtentForSite(null).cols).toBe(65)
    expect(fieldExtentForSite(undefined).cols).toBe(65)
  })
})

describe('sculptFieldForSite', () => {
  test('a virgin site gets a fresh flat field sized to its lot', () => {
    const target = site([
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ])
    const field = sculptFieldForSite(target)
    expect(field.cols).toBe(fieldExtentForSite(target).cols)
    expect(heightAt(field, 0, 0)).toBeCloseTo(0, 6)
  })
})

describe('site footprint', () => {
  const concaveSite = site([
    [0, 0],
    [4, 0],
    [4, 2],
    [2, 2],
    [2, 4],
    [0, 4],
  ])

  test('includes the boundary but excludes the padded field and concave notch', () => {
    expect(terrainPointInsideSite(concaveSite, 0, 2)).toBe(true)
    expect(terrainPointInsideSite(concaveSite, 1, 3)).toBe(true)
    expect(terrainPointInsideSite(concaveSite, 3, 3)).toBe(false)
    expect(terrainPointInsideSite(concaveSite, -1, 2)).toBe(false)
  })

  test('a brush patch preserves samples outside the property polygon', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 1, origin: [0, 0] })
    const heights = new Int16Array(25)
    heights.fill(100)
    const clipped = clipTerrainPatchToSite(
      field,
      { col0: 0, row0: 0, cols: 5, rows: 5, heights },
      concaveSite,
    )

    expect(clipped.heights[1 * 5 + 1]).toBe(100)
    expect(clipped.heights[3 * 5 + 3]).toBe(0)
    expect(clipped.heights[2 * 5 + 0]).toBe(100)
    expect(clipped.heights[2 * 5 + 4]).toBe(100)
  })
})

describe('brushRadiusRange', () => {
  const hugeLot = site([
    [-200, -200],
    [200, -200],
    [200, 200],
    [-200, 200],
  ])
  const smallLot = site([
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ])

  test('the low end is the field floor, not a constant', () => {
    // The bug: both the slider and the `[`/`]` keys hardcoded 0.5 m. On a lot big
    // enough that `fieldExtentForSite` stretches spacing, 0.5 m is under the
    // sample gap and the brush silently paints nothing. The floor has to move
    // with the lot.
    const [smallMin] = brushRadiusRange(smallLot)
    const [hugeMin] = brushRadiusRange(hugeLot)
    expect(smallMin).toBeCloseTo(minBrushRadius({ spacing: DEFAULT_TERRAIN_SPACING }), 6)
    expect(hugeMin).toBeGreaterThan(smallMin)
    expect(hugeMin).toBeCloseTo(minBrushRadius(sculptFieldForSite(hugeLot)), 6)
  })

  test('reads the spacing of terrain that already exists', () => {
    // A lot whose field was created earlier (or imported from a DEM at its own
    // resolution) must be measured by *that* field, not by what a fresh one
    // would get — otherwise the floor is wrong for exactly the sites that have
    // been sculpted.
    const existing = { ...smallLot, terrain: { spacing: 4 } } as unknown as SiteNode
    const [min] = brushRadiusRange(existing)
    expect(min).toBeCloseTo(minBrushRadius({ spacing: 4 }), 6)
  })

  test('a site with no lot yet still yields a usable range', () => {
    for (const target of [null, undefined]) {
      const [min, max] = brushRadiusRange(target)
      expect(min).toBeGreaterThan(0)
      expect(max).toBeGreaterThan(min)
    }
  })

  test('the range never inverts', () => {
    // Reachable: a lot coarse enough that the floor passes MAX_BRUSH_RADIUS would
    // otherwise give min > max, and a slider whose min exceeds its max clamps
    // every value to a different number depending on which bound is applied last.
    for (const spacing of [0.5, 4, 20, 100]) {
      const target = { ...smallLot, terrain: { spacing } } as unknown as SiteNode
      const [min, max] = brushRadiusRange(target)
      expect(max).toBeGreaterThanOrEqual(min)
      expect(clampBrushRadius(target, 1)).toBeGreaterThanOrEqual(min)
      expect(clampBrushRadius(target, 1e6)).toBeLessThanOrEqual(max)
    }
  })
})

describe('clampBrushRadius', () => {
  const lot = site([
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ])

  test('holds a radius already in range untouched', () => {
    expect(clampBrushRadius(lot, 5)).toBe(5)
  })

  test('the `[`/`]` ladder stays inside the range and reverses', () => {
    // The keys step multiplicatively (×1.25) and quantize to decimetres, which is
    // where a ratchet would hide: if `]` then `[` did not return, the pair would
    // walk the radius away from where the user left it. Only the clamp at the top
    // is allowed to be one-way.
    const step = (radius: number, up: boolean) =>
      clampBrushRadius(lot, Math.round(radius * (up ? 1.25 : 1 / 1.25) * 10) / 10)
    const [min, max] = brushRadiusRange(lot)

    let radius = min
    const visited: number[] = []
    for (let i = 0; i < 40 && radius < max; i++) {
      const next = step(radius, true)
      if (next === radius) break
      visited.push(next)
      radius = next
    }
    // The ladder has to actually traverse the range, or `]` is a dead key
    // somewhere in the middle.
    expect(visited.at(-1)).toBe(max)
    expect(visited.length).toBeGreaterThan(8)

    for (const value of visited) {
      expect(value).toBeGreaterThanOrEqual(min)
      expect(value).toBeLessThanOrEqual(max)
      // Below the top, up-then-down returns. At the ceiling it cannot: one step
      // down from the max is a genuine 20% reduction, which is correct.
      if (step(value, true) !== max) expect(step(step(value, true), false)).toBe(value)
    }
  })
})

describe('resolveFlattenTarget', () => {
  test('an explicit target wins over the ground under the cursor', () => {
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 0.5, origin: [-8, -8] })
    expect(resolveFlattenTarget(field, 3.25, 0, 0)).toBeCloseTo(3.25, 6)
  })

  test('with no explicit target the first click samples the ground', () => {
    // This is what makes flatten usable without ever opening a number field.
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 0.5, origin: [-8, -8] })
    const raised = { ...field, heights: field.heights.slice() }
    // Sample [16,16] is world (0,0) — put it at 1.5 m.
    raised.heights[16 * 33 + 16] = Math.round(1.5 / raised.step)
    expect(resolveFlattenTarget(raised, null, 0, 0)).toBeCloseTo(1.5, 6)
  })

  test('an explicit target of 0 is honoured, not treated as absent', () => {
    // `?? ` rather than `||` — flatten-to-datum is the single most common
    // explicit target, and `||` would silently resample instead.
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 0.5, origin: [-8, -8] })
    const raised = { ...field, heights: field.heights.slice() }
    raised.heights[16 * 33 + 16] = Math.round(2 / raised.step)
    expect(resolveFlattenTarget(raised, 0, 0, 0)).toBe(0)
  })
})

/**
 * What Escape mid-stroke actually promises.
 *
 * The tool's `tool:cancel` handler ends the live stroke *without* calling
 * `commitStroke`, which is the whole mechanism: the live stroke is what every reader
 * prefers over the persisted terrain, so dropping it un-committed reverts the scene
 * by construction. The half worth asserting is that it reverts to the *right* place —
 * a site sculpted before the abandoned stroke must keep that earlier work — and that
 * the abandon leaves no live stroke behind for the next reader to pick up.
 */
describe('abandoning a stroke — the Escape contract', () => {
  const siteId = 'site_cancel' as SiteNode['id']

  function fieldAt(metres: number): ReturnType<typeof createTerrainField> {
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 0.5, origin: [-8, -8] })
    const heights = field.heights.slice()
    heights.fill(Math.round(metres / field.step))
    return { ...field, heights }
  }

  test('ends the live stroke and commits nothing', () => {
    const committed = fieldAt(1.5)
    useLiveTerrain.getState().begin(siteId, committed)
    useLiveTerrain.getState().advance(siteId, fieldAt(9), null as never)
    expect(useLiveTerrain.getState().fieldOf(siteId)).toBeDefined()

    // Exactly what the tool's `onCancel` does: end, no `commitStroke`.
    useLiveTerrain.getState().end(siteId)

    // No stroke left armed — a leaked one shows ground the scene graph never had.
    expect(useLiveTerrain.getState().strokes.has(siteId)).toBe(false)
    expect(useLiveTerrain.getState().fieldOf(siteId)).toBeUndefined()
  })

  test('the snapshot taken at begin is never mutated by the dabs it survives', () => {
    // The anti-compounding invariant, from the cancel side: if a dab could write
    // through to the snapshot, Escape would revert to a *partially* sculpted field
    // rather than the baseline, and the user's earlier work would drift every stroke.
    const committed = fieldAt(1.5)
    const baseline = Array.from(committed.heights)
    useLiveTerrain.getState().begin(siteId, committed)
    useLiveTerrain.getState().advance(siteId, fieldAt(9), null as never)
    useLiveTerrain.getState().end(siteId)
    expect(Array.from(committed.heights)).toEqual(baseline)
  })
})

/**
 * The lot-wide writes have to win over a stroke in flight.
 *
 * Both replace the entire field, and every reader prefers the live stroke over the
 * persisted terrain — so landing one *under* a stroke is invisible twice over: the
 * ground keeps showing the stroke, and the stroke's commit (computed from a snapshot
 * predating the write) then overwrites it. A button that silently does nothing.
 *
 * Not a hypothetical race. On touch one finger holds a stroke while the other taps
 * the panel; with a mouse a stroke survives a wheel zoom's 500 ms `cameraDragging`
 * window and a held pointer that has left the canvas.
 */
describe('lot-wide terrain writes vs a stroke in flight', () => {
  const lotSiteId = 'site_lotwide' as SiteNode['id']

  function siteNodeWithTerrain(terrain: SiteNode['terrain']): SiteNode {
    return {
      id: lotSiteId,
      type: 'site',
      children: [],
      polygon: {
        type: 'polygon',
        points: [
          [-10, -10],
          [10, -10],
          [10, 10],
          [-10, 10],
        ],
      },
      terrain,
    } as unknown as SiteNode
  }

  beforeEach(() => {
    useLiveTerrain.getState().endAll()
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() } as never)
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
  })

  test('levelling the lot drops the stroke instead of hiding behind it', () => {
    const site = siteNodeWithTerrain(undefined)
    useScene.setState({ nodes: { [lotSiteId]: site }, rootNodeIds: [lotSiteId] } as never)
    useLiveTerrain.getState().begin(lotSiteId, sculptFieldForSite(site))

    flattenSite(site, 3)

    // The assertion that fails without the abandon: with a stroke still live,
    // `terrainFieldOf` — and so the mesh, the raycast and the next stroke's
    // snapshot — would keep reading the pre-flatten ground.
    expect(useLiveTerrain.getState().fieldOf(lotSiteId)).toBeUndefined()
    const written = useScene.getState().nodes[lotSiteId] as SiteNode
    expect(heightAt(terrainFieldOf(written) as never, 0, 0)).toBeCloseTo(3, 6)
  })

  test('clearing terrain drops the stroke even when there is nothing to clear', () => {
    // The early-return path: a first-ever stroke on a virgin site leaves
    // `site.terrain` undefined, so `resetSiteTerrain` returns before writing —
    // and a live stroke surviving that shows ground the scene graph has none of.
    const site = siteNodeWithTerrain(undefined)
    useScene.setState({ nodes: { [lotSiteId]: site }, rootNodeIds: [lotSiteId] } as never)
    useLiveTerrain.getState().begin(lotSiteId, sculptFieldForSite(site))

    resetSiteTerrain(site)

    expect(useLiveTerrain.getState().fieldOf(lotSiteId)).toBeUndefined()
    expect(terrainFieldOf(useScene.getState().nodes[lotSiteId] as SiteNode)).toBeNull()
  })
})

describe('excavateSiteToModel', () => {
  const siteId = 'site_excavate' as SiteNode['id']

  beforeEach(() => {
    useLiveTerrain.getState().endAll()
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() } as never)
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
  })

  test('excavates terrain under a basement slab to its underside elevation', () => {
    const siteNode: SiteNode = {
      id: siteId,
      type: 'site',
      children: ['bldg_1'],
      polygon: {
        type: 'polygon',
        points: [
          [-20, -20],
          [20, -20],
          [20, 20],
          [-20, 20],
        ],
      },
    } as unknown as SiteNode

    const nodes = {
      [siteId]: siteNode,
      bldg_1: {
        id: 'bldg_1',
        type: 'building',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        children: ['level_basement'],
      },
      level_basement: {
        id: 'level_basement',
        type: 'level',
        baseElevation: -2.2,
        height: 2.2,
        level: -1,
        children: ['slab_basement'],
      },
      slab_basement: {
        id: 'slab_basement',
        type: 'slab',
        parentId: 'level_basement',
        polygon: [
          [-5, -5],
          [5, -5],
          [5, 5],
          [-5, 5],
        ],
        elevation: 0.05,
        thickness: 0.2, // underside is -2.2 + (0.05 - 0.2) = -2.35
      },
    } as never

    useScene.setState({ nodes, rootNodeIds: [siteId] } as never)

    // Flat terrain at Y = 1.0 m
    flattenSite(siteNode, 1.0)
    const siteWithTerrain = useScene.getState().nodes[siteId] as SiteNode

    excavateSiteToModel(siteWithTerrain, useScene.getState().nodes)

    const updatedSite = useScene.getState().nodes[siteId] as SiteNode
    const field = terrainFieldOf(updatedSite)!
    expect(field).toBeDefined()

    // Inside the basement slab (0, 0): should be excavated to -2.35 m
    expect(heightAt(field, 0, 0)).toBeCloseTo(-2.35, 2)
    expect(heightAt(field, 2, 2)).toBeCloseTo(-2.35, 2)

    // Outside the basement slab (10, 10): should remain at 1.0 m
    expect(heightAt(field, 10, 10)).toBeCloseTo(1.0, 2)
  })

  test('does not raise terrain that is already below the slab underside (cut-only)', () => {
    const siteNode: SiteNode = {
      id: siteId,
      type: 'site',
      children: ['bldg_1'],
      polygon: {
        type: 'polygon',
        points: [
          [-20, -20],
          [20, -20],
          [20, 20],
          [-20, 20],
        ],
      },
    } as unknown as SiteNode

    const nodes = {
      [siteId]: siteNode,
      bldg_1: {
        id: 'bldg_1',
        type: 'building',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        children: ['level_0'],
      },
      level_0: {
        id: 'level_0',
        type: 'level',
        baseElevation: 0,
        height: 2.8,
        level: 0,
        children: ['slab_1'],
      },
      slab_1: {
        id: 'slab_1',
        type: 'slab',
        parentId: 'level_0',
        polygon: [
          [-5, -5],
          [5, -5],
          [5, 5],
          [-5, 5],
        ],
        elevation: 0.05,
        thickness: 0.05, // underside is 0.0
      },
    } as never

    useScene.setState({ nodes, rootNodeIds: [siteId] } as never)

    // Terrain in a hollow at Y = -1.5 m
    flattenSite(siteNode, -1.5)
    const siteWithTerrain = useScene.getState().nodes[siteId] as SiteNode

    excavateSiteToModel(siteWithTerrain, useScene.getState().nodes)

    const updatedSite = useScene.getState().nodes[siteId] as SiteNode
    const field = terrainFieldOf(updatedSite)!
    // Under the slab: terrain should remain at -1.5 m rather than being lifted to 0.0 m
    expect(heightAt(field, 0, 0)).toBeCloseTo(-1.5, 2)
  })

  test('multi-level overlapping slabs excavate to the lowest underside elevation', () => {
    const siteNode: SiteNode = {
      id: siteId,
      type: 'site',
      children: ['bldg_1'],
      polygon: {
        type: 'polygon',
        points: [
          [-20, -20],
          [20, -20],
          [20, 20],
          [-20, 20],
        ],
      },
    } as unknown as SiteNode

    const nodes = {
      [siteId]: siteNode,
      bldg_1: {
        id: 'bldg_1',
        type: 'building',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        children: ['level_0', 'level_basement'],
      },
      level_0: {
        id: 'level_0',
        type: 'level',
        baseElevation: 0,
        height: 2.8,
        level: 0,
        children: ['slab_level0'],
      },
      level_basement: {
        id: 'level_basement',
        type: 'level',
        baseElevation: -2.5,
        height: 2.5,
        level: -1,
        children: ['slab_basement'],
      },
      slab_level0: {
        id: 'slab_level0',
        type: 'slab',
        parentId: 'level_0',
        polygon: [
          [-8, -8],
          [8, -8],
          [8, 8],
          [-8, 8],
        ],
        elevation: 0.05,
        thickness: 0.05, // underside is 0.0
      },
      slab_basement: {
        id: 'slab_basement',
        type: 'slab',
        parentId: 'level_basement',
        polygon: [
          [-4, -4],
          [4, -4],
          [4, 4],
          [-4, 4],
        ],
        elevation: 0.05,
        thickness: 0.1, // underside is -2.5 + (0.05 - 0.1) = -2.55
      },
    } as never

    useScene.setState({ nodes, rootNodeIds: [siteId] } as never)
    flattenSite(siteNode, 2.0)
    const siteWithTerrain = useScene.getState().nodes[siteId] as SiteNode

    excavateSiteToModel(siteWithTerrain, useScene.getState().nodes)

    const updatedSite = useScene.getState().nodes[siteId] as SiteNode
    const field = terrainFieldOf(updatedSite)!

    // Overlapping area (basement footprint): excavated down to -2.55 m
    expect(heightAt(field, 0, 0)).toBeCloseTo(-2.55, 2)

    // Level 0 only area (x = 6, z = 6): excavated down to 0.0 m
    expect(heightAt(field, 6, 6)).toBeCloseTo(0.0, 2)

    // Outside both slabs (x = 12, z = 12): stays at 2.0 m
    expect(heightAt(field, 12, 12)).toBeCloseTo(2.0, 2)
  })

  test('excavates terrain along the slope gradient under a sloped slab ramp', () => {
    const siteNode = site([
      [-15, -15],
      [15, -15],
      [15, 15],
      [-15, 15],
    ])
    const siteId = siteNode.id

    const nodes = {
      [siteId]: siteNode,
      building_1: {
        id: 'building_1',
        type: 'building',
        parentId: siteId,
        children: ['level_0'],
        position: [0, 0, 0],
      },
      level_0: {
        id: 'level_0',
        type: 'level',
        parentId: 'building_1',
        baseElevation: 0,
        height: 2.8,
        level: 0,
        children: ['slab_ramp'],
      },
      slab_ramp: {
        id: 'slab_ramp',
        type: 'slab',
        parentId: 'level_0',
        polygon: [
          [0, -2],
          [10, -2],
          [10, 2],
          [0, 2],
        ],
        elevation: 0.2,
        thickness: 0.1,
        slopeAngle: 5.710593, // tan = 0.1 (rises 1.0m over 10m)
        slopeDirection: 0, // along +X
      },
    } as never

    useScene.setState({ nodes, rootNodeIds: [siteId] } as never)
    flattenSite(siteNode, 3.0)
    const siteWithTerrain = useScene.getState().nodes[siteId] as SiteNode

    excavateSiteToModel(siteWithTerrain, useScene.getState().nodes)

    const updatedSite = useScene.getState().nodes[siteId] as SiteNode
    const field = terrainFieldOf(updatedSite)!

    // At x=0 (ramp start): underside is 0.2 - 0.1 = 0.1m
    expect(heightAt(field, 0, 0)).toBeCloseTo(0.1, 1)

    // At x=5 (ramp midpoint): underside is 0.1 + 5 * 0.1 = 0.6m
    expect(heightAt(field, 5, 0)).toBeCloseTo(0.6, 1)

    // At x=10 (ramp top): underside is 0.1 + 10 * 0.1 = 1.1m
    expect(heightAt(field, 10, 0)).toBeCloseTo(1.1, 1)

    // Outside the ramp at x=13: stays at 3.0m
    expect(heightAt(field, 13, 0)).toBeCloseTo(3.0, 1)
  })
})


