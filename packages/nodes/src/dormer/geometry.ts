import {
  type DormerNode,
  getPitchFromActiveRoofHeight,
  getRoofModuleFaces,
  getRoofShapeRatios,
  ROOF_SHAPE_DEFAULTS,
} from '@pascal-app/core'
import * as THREE from 'three'

/**
 * Grid-snap step (metres) applied to the world cursor position while a
 * dormer placement / move ghost is in flight. Shared by both tools so
 * the audible snap and the committed position step stay in lockstep.
 */
export const DORMER_PLACEMENT_SNAP_M = 0.05

/**
 * Rotation step (radians) used by the keyboard rotate shortcuts (R /
 * Shift+R) while a dormer placement / move ghost is in flight. 15° —
 * lets the user reach the 90° cardinals in six taps and the 45°
 * diagonals in three.
 */
export const DORMER_PLACEMENT_ROTATION_STEP = (15 * Math.PI) / 180

/**
 * Builds the lightweight placement and live-edit shell from the same
 * per-type face generator used by committed roof geometry.
 */
export function buildDormerShellGeometry(node: DormerNode): THREE.BufferGeometry {
  const w = Math.max(0.05, node.width)
  const wallH = Math.max(0.05, node.height)
  const roofH = Math.max(0, node.roofHeight)
  const d = Math.max(0.05, node.depth)
  const skirt = Math.max(0.05, node.wallSkirtHeight ?? 2)
  const isShed = node.roofType === 'shed'
  const segW = isShed ? w : d
  const segD = isShed ? d : w
  const pitch = getPitchFromActiveRoofHeight({
    roofType: node.roofType,
    width: segW,
    depth: segD,
    roofHeight: roofH,
  })
  const faces = getRoofModuleFaces({
    type: node.roofType,
    w: segW,
    d: segD,
    wh: wallH,
    rh: roofH,
    baseY: -skirt,
    insets: {},
    baseW: segW,
    baseD: segD,
    tanTheta: Math.tan((pitch * Math.PI) / 180),
    shapeRatios: getRoofShapeRatios(ROOF_SHAPE_DEFAULTS),
  })
  const positions: number[] = []
  const materialGroups: Array<{ start: number; count: number; materialIndex: number }> = []

  for (const face of faces) {
    if (face.length < 3) continue
    const a = new THREE.Vector3(face[0]!.x, face[0]!.y, face[0]!.z)
    const b = new THREE.Vector3(face[1]!.x, face[1]!.y, face[1]!.z)
    const c = new THREE.Vector3(face[2]!.x, face[2]!.y, face[2]!.z)
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
    const start = positions.length / 3
    for (let index = 1; index < face.length - 1; index++) {
      for (const point of [face[0]!, face[index]!, face[index + 1]!]) {
        positions.push(point.x, point.y, point.z)
      }
    }
    materialGroups.push({
      start,
      count: positions.length / 3 - start,
      materialIndex: normal.y > 0.01 ? 3 : 0,
    })
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  for (const group of materialGroups)
    geometry.addGroup(group.start, group.count, group.materialIndex)
  if (!isShed) geometry.rotateY(Math.PI / 2)
  geometry.computeVertexNormals()
  return geometry
}

export function buildDormerGhostGeometry(node: DormerNode): THREE.BufferGeometry {
  return buildDormerShellGeometry(node)
}

/**
 * Computes window opening layout (offsets, dimensions, count) for a dormer.
 * Multi-window layout is only enabled for shed dormers.
 */
export function getDormerWindowLayout(dormer: DormerNode): {
  count: number
  instances: Array<{ x: number }>
  width: number
  height: number
  centerY: number
} {
  const isShed = dormer.roofType === 'shed'
  const count = isShed ? Math.max(1, Math.min(8, Math.round(dormer.windowCount ?? 1))) : 1
  const spacing = isShed ? Math.max(0, dormer.windowSpacing ?? 0.1) : 0

  const skirtH = Math.max(0.05, dormer.wallSkirtHeight ?? 2)
  const maxW = Math.max(0.1, dormer.width - 0.05)
  const maxH = Math.max(0.1, skirtH - 0.05)

  const rawW = Math.min(Math.max(dormer.windowWidth ?? 1.2, 0.1), maxW)
  const height = Math.min(Math.max(dormer.windowHeight ?? 1.2, 0.1), maxH)

  const totalGap = (count - 1) * spacing
  const maxPerWindow = Math.max(0.1, (maxW - totalGap) / count)
  const width = Math.min(rawW, maxPerWindow)

  const totalSpan = count * width + totalGap
  const startX = -totalSpan / 2 + width / 2
  const centerShift = dormer.windowOffsetX ?? 0

  const instances: Array<{ x: number }> = []
  for (let i = 0; i < count; i++) {
    const x = centerShift + startX + i * (width + spacing)
    instances.push({ x })
  }

  const centerY = -(skirtH / 2) + (dormer.windowOffsetY ?? 0)

  return {
    count,
    instances,
    width,
    height,
    centerY,
  }
}

/**
 * Inspector helper: which window-shape sub-controls to surface for the
 * current dormer.
 */
export function dormerSupportsArch(node: DormerNode): boolean {
  return node.windowShape === 'arch'
}

export function dormerSupportsCornerRadii(node: DormerNode): boolean {
  return node.windowShape === 'rounded'
}

