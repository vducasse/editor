import type { AnyNode, AnyNodeId, DormerNode, RoofSegmentNode, SlabNode } from '@pascal-app/core'
import {
  getLevelElevations,
  getRoofModuleFaces,
  getRoofShapeRatios,
  getSegmentSlopeFrame,
  sceneRegistry,
} from '@pascal-app/core'
import polygonClipping from 'polygon-clipping'
import * as THREE from 'three'

export type Point2D = [number, number]

type Vec3 = { x: number; y: number; z: number }

/**
 * Cut each edge of every face polygon with the horizontal plane Y = cutY.
 * Face polygons are quads/tris (not triangulated meshes), so a single
 * sloped face produces a segment spanning the full width — exactly what
 * a horizontal cross-section should look like.
 */
function sliceFacesAtY(
  faces: Vec3[][],
  cutY: number,
): Array<[Point2D, Point2D]> {
  const segments: Array<[Point2D, Point2D]> = []
  const EPS = 1e-6

  for (const face of faces) {
    const pts: Point2D[] = []
    const n = face.length

    for (let i = 0; i < n; i++) {
      const a = face[i]!
      const b = face[(i + 1) % n]!
      const da = a.y - cutY
      const db = b.y - cutY

      if (Math.abs(da) < EPS && Math.abs(db) < EPS) continue

      if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
        const t = da / (da - db)
        pts.push([a.x + t * (b.x - a.x), a.z + t * (b.z - a.z)])
      } else if (Math.abs(da) < EPS) {
        pts.push([a.x, a.z])
      }
    }

    if (pts.length >= 2) {
      segments.push([pts[0]!, pts[1]!])
    }
  }

  return segments
}

/**
 * Snap a 2D point to a grid to build a hash key.
 */
function pointKey(p: Point2D, resolution = 1e4): string {
  return `${Math.round(p[0] * resolution)},${Math.round(p[1] * resolution)}`
}

/**
 * Extract all closed contours from an unordered set of line segments.
 * Uses endpoint-hash indexing (the same approach 3D printing slicers use).
 */
function chainSegments(segments: Array<[Point2D, Point2D]>): Point2D[][] | null {
  if (segments.length < 3) return null

  const adj = new Map<string, Array<{ segIdx: number; end: 0 | 1 }>>()
  for (let i = 0; i < segments.length; i++) {
    for (const end of [0, 1] as const) {
      const key = pointKey(segments[i]![end])
      let list = adj.get(key)
      if (!list) {
        list = []
        adj.set(key, list)
      }
      list.push({ segIdx: i, end })
    }
  }

  const used = new Set<number>()
  const loops: Point2D[][] = []

  for (let startIdx = 0; startIdx < segments.length; startIdx++) {
    if (used.has(startIdx)) continue

    const loop: Point2D[] = []
    let currentIdx = startIdx
    let exitEnd: 0 | 1 = 1

    for (let safety = 0; safety < segments.length + 1; safety++) {
      used.add(currentIdx)
      const seg = segments[currentIdx]!
      loop.push(seg[exitEnd])

      const exitKey = pointKey(seg[exitEnd])
      const neighbors = adj.get(exitKey)
      if (!neighbors) break

      let found = false
      for (const nb of neighbors) {
        if (nb.segIdx === currentIdx || used.has(nb.segIdx)) continue
        currentIdx = nb.segIdx
        exitEnd = nb.end === 0 ? 1 : 0
        found = true
        break
      }

      if (!found) break
    }

    if (loop.length >= 3) loops.push(loop)
  }

  return loops.length > 0 ? loops : null
}

/**
 * Chain segments and return the loop with the largest area.
 */
function extractLargestLoop(segments: Array<[Point2D, Point2D]>): Point2D[] | null {
  const loops = chainSegments(segments)
  if (!loops) return null

  let bestLoop = loops[0]!
  let bestArea = 0
  for (const loop of loops) {
    let area = 0
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!
      const b = loop[(i + 1) % loop.length]!
      area += a[0] * b[1] - b[0] * a[1]
    }
    if (Math.abs(area) > bestArea) {
      bestArea = Math.abs(area)
      bestLoop = loop
    }
  }

  return bestArea > 0.001 ? bestLoop : null
}

/**
 * Remove nearly-collinear vertices from a polygon.
 */
function simplifyPolygon(poly: Point2D[], tolerance: number): Point2D[] {
  if (poly.length <= 3) return poly

  let changed = true
  let pts = [...poly]

  while (changed) {
    changed = false
    const keep: Point2D[] = []

    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length]!
      const curr = pts[i]!
      const next = pts[(i + 1) % pts.length]!

      const dx = next[0] - prev[0]
      const dz = next[1] - prev[1]
      const len = Math.hypot(dx, dz)
      if (len < 1e-9) continue

      const dist = Math.abs(dx * (prev[1] - curr[1]) - dz * (prev[0] - curr[0])) / len
      if (dist > tolerance) {
        keep.push(curr)
      } else {
        changed = true
      }
    }

    pts = keep
  }

  return pts
}

/**
 * Computes the slab polygon by cutting roof-segment FACE POLYGONS with a
 * horizontal plane at the slab's world elevation.
 *
 * Uses `getRoofModuleFaces()` from core — the same face polygons the GPU
 * renders. Each sloped face produces a full-width intersection segment,
 * giving the correct horizontal cross-section of the roof volume.
 *
 * @returns The 2D polygon `[x, y_plan][]` in Pascal plan coordinates, or `null`.
 */
export function fitSlabPolygonToRoof(
  slab: SlabNode,
  nodes: Record<string, AnyNode>,
): Point2D[] | null {
  if (!slab) return null

  // 1. Resolve the slab's absolute world Y
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const slabAbsY = (elevations.get(slab.parentId ?? '')?.baseY ?? 0) + (slab.elevation ?? 0)

  // 2. Collect solid contours from each roof-segment and dormer
  const contours: Point2D[][] = []

  for (const [id, node] of Object.entries(nodes)) {
    if (node.type !== 'roof-segment' && node.type !== 'dormer') continue

    const obj3d = sceneRegistry.nodes.get(id)
    if (!obj3d) continue

    obj3d.updateWorldMatrix(true, false)
    const matrixWorld = obj3d.matrixWorld

    let faces: Vec3[][] = []

    if (node.type === 'roof-segment') {
      const seg = node as RoofSegmentNode
      const { activeRh, tanTheta } = getSegmentSlopeFrame(seg)
      const shapeRatios = getRoofShapeRatios({
        gambrelLowerWidthRatio: seg.gambrelLowerWidthRatio,
        mansardSteepWidthRatio: seg.mansardSteepWidthRatio,
        dutchHipWidthRatio: seg.dutchHipWidthRatio,
        dutchHipHeightRatio: seg.dutchHipHeightRatio,
        dutchWaistLengthRatio: seg.dutchWaistLengthRatio,
        dutchGabletRake: seg.dutchGabletRake,
      })

      // Use interior wall face dimensions so the floor slab is enclosed within the walls/roof,
      // preventing the slab perimeter from penetrating through the exterior wall/facade cladding.
      const wExt = -seg.wallThickness / 2
      const wV = Math.max(0.01, seg.width + 2 * wExt)
      const dV = Math.max(0.01, seg.depth + 2 * wExt)
      const autoDrop = 0
      const whV = Math.max(0.01, seg.wallHeight)
      const rhV = activeRh

      faces = getRoofModuleFaces({
        type: seg.roofType,
        w: wV,
        d: dV,
        wh: whV,
        rh: rhV,
        baseY: 0,
        insets: { dutchI: Math.min(seg.width, seg.depth) * seg.dutchHipWidthRatio },
        baseW: seg.width,
        baseD: seg.depth,
        tanTheta,
        shapeRatios,
        dutchTopRakeThickness: seg.dutchTopRakeThickness,
      })
    } else {
      const dormer = node as DormerNode
      faces = getRoofModuleFaces({
        type: dormer.roofType,
        w: dormer.width,
        d: dormer.depth,
        wh: dormer.height,
        rh: dormer.roofHeight,
        baseY: -(dormer.wallSkirtHeight ?? 0),
        insets: { dutchI: 0 },
        baseW: dormer.width,
        baseD: dormer.depth,
        tanTheta: dormer.roofHeight > 0 ? dormer.roofHeight / (dormer.depth / 2) : 0,
        shapeRatios: getRoofShapeRatios({}),
      })
    }

    const worldFaces = faces.map((face) =>
      face.map((v) => {
        const vec = new THREE.Vector3(v.x, v.y, v.z)
        vec.applyMatrix4(matrixWorld)
        return { x: vec.x, y: vec.y, z: vec.z }
      })
    )

    const segs = sliceFacesAtY(worldFaces, slabAbsY)
    const loop = extractLargestLoop(segs)
    if (loop) {
      contours.push(loop)
    }
  }

  if (contours.length === 0) return null

  // 3. Boolean union all contours to merge the roof and dormers
  let finalRing: Point2D[]
  if (contours.length === 1) {
    finalRing = contours[0]!
  } else {
    try {
      // Round coordinates to millimeters BEFORE boolean union to prevent
      // float jitter from creating microscopic zig-zags that choke triangulation.
      const round3 = (v: number) => Math.round(v * 1000) / 1000
      
      const toRing = (loop: Point2D[]): [number, number][] =>
        loop.map((p) => [round3(p[0]), round3(p[1])] as [number, number])
        
      const polys = contours.map((c) => [toRing(c)])
      const result = polygonClipping.union(polys[0]! as polygonClipping.Polygon, ...polys.slice(1) as polygonClipping.Polygon[])

      if (result.length > 0 && result[0]![0]!.length >= 3) {
        const ring = result[0]![0]!
        finalRing = ring.map((pt: [number, number]) => [pt[0], pt[1]] as Point2D)
        // Remove closing duplicate
        if (finalRing.length > 1) {
          const f = finalRing[0]!
          const l = finalRing.at(-1)!
          if (f[0] === l[0] && f[1] === l[1]) finalRing.pop()
        }
      } else {
        finalRing = contours[0]!
      }
    } catch {
      finalRing = contours[0]!
    }
  }

  // 4. Convert to Pascal 2D plan coordinates and simplify
  const raw: Point2D[] = finalRing.map(([x, z]) => [
    Number(x.toFixed(4)),
    Number(z.toFixed(4)),
  ])

  const result = simplifyPolygon(raw, 0.01)
  return result.length >= 3 ? result : null
}
