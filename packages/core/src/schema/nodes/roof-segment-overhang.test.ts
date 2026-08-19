import { describe, expect, test } from 'bun:test'
import {
  getRoofSegmentVisibleTopBounds,
  resolveRoofSegmentOverhang,
  RoofSegmentNode,
} from './roof-segment'

describe('Roof segment overhang', () => {
  test('falls back to uniform overhang when width/depth are undefined', () => {
    const seg = RoofSegmentNode.parse({ overhang: 0.4 })
    const { overhangX, overhangZ } = resolveRoofSegmentOverhang(seg)
    expect(overhangX).toBe(0.4)
    expect(overhangZ).toBe(0.4)
  })

  test('resolves independent overhangWidth and overhangDepth', () => {
    const seg = RoofSegmentNode.parse({
      overhang: 0.3,
      overhangWidth: 0.5,
      overhangDepth: 0.1,
    })
    const { overhangX, overhangZ } = resolveRoofSegmentOverhang(seg)
    expect(overhangX).toBe(0.5)
    expect(overhangZ).toBe(0.1)
  })

  test('getRoofSegmentVisibleTopBounds reflects asymmetric overhang', () => {
    const segUniform = RoofSegmentNode.parse({
      width: 4,
      depth: 6,
      overhang: 0.2,
      pitch: 0,
    })
    const boundsUniform = getRoofSegmentVisibleTopBounds(segUniform)

    const segAsymmetric = RoofSegmentNode.parse({
      width: 4,
      depth: 6,
      overhang: 0.2,
      overhangWidth: 0.6,
      overhangDepth: 0.1,
      pitch: 0,
    })
    const boundsAsym = getRoofSegmentVisibleTopBounds(segAsymmetric)

    expect(boundsAsym.width).toBeGreaterThan(boundsUniform.width)
    expect(boundsAsym.depth).toBeLessThan(boundsUniform.depth)
  })
})
