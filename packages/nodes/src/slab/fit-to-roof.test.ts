import { describe, expect, test } from 'bun:test'
import { fitSlabPolygonToRoof } from './fit-to-roof'

describe('fitSlabPolygonToRoof', () => {
  test('returns null if slab node is null or undefined', () => {
    expect(fitSlabPolygonToRoof(null as any, {})).toBeNull()
  })

  test('returns null if sceneRegistry has no roof-segment meshes', () => {
    const slab = {
      id: 'slab_1',
      type: 'slab',
      parentId: 'level_0',
      polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
      thickness: 0.15,
      elevation: 0,
    } as any

    const level = {
      id: 'level_0',
      type: 'level',
      parentId: null,
      level: 0,
      height: 2.5,
    } as any

    // No meshes registered -> returns null
    expect(fitSlabPolygonToRoof(slab, { slab_1: slab, level_0: level })).toBeNull()
  })
})
