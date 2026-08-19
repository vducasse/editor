import { describe, expect, test } from 'bun:test'
import { DormerNode, getEffectiveDormerSurfaceMaterial } from './dormer'

describe('DormerNode schema in core', () => {
  test('defaults windowCount to 1 and windowSpacing to 0.1', () => {
    const parsed = DormerNode.parse({})
    expect(parsed.windowCount).toBe(1)
    expect(parsed.windowSpacing).toBe(0.1)
  })

  test('validates windowCount range [1, 8]', () => {
    expect(() => DormerNode.parse({ windowCount: 0 })).toThrow()
    expect(() => DormerNode.parse({ windowCount: 9 })).toThrow()
    expect(DormerNode.parse({ windowCount: 4 }).windowCount).toBe(4)
  })

  test('validates windowSpacing non-negative', () => {
    expect(() => DormerNode.parse({ windowSpacing: -0.5 })).toThrow()
    expect(DormerNode.parse({ windowSpacing: 0.25 }).windowSpacing).toBe(0.25)
  })

  test('window role material resolution and fallback', () => {
    const node1 = DormerNode.parse({ windowMaterialPreset: 'black_metal' })
    expect(getEffectiveDormerSurfaceMaterial(node1, 'window').materialPreset).toBe('black_metal')

    const node2 = DormerNode.parse({ sideMaterialPreset: 'wood' })
    expect(getEffectiveDormerSurfaceMaterial(node2, 'window').materialPreset).toBe('wood')

    const node3 = DormerNode.parse({ materialPreset: 'stucco' })
    expect(getEffectiveDormerSurfaceMaterial(node3, 'window').materialPreset).toBe('stucco')
  })
})
