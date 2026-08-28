import { describe, expect, it } from 'bun:test'
import { windowDefinition } from './definition'
import { WindowNode } from './schema'

describe('window resize handles on non-wall hosts', () => {
  it('does not throw when host is not a standard wall node', () => {
    const window = WindowNode.parse({
      id: 'window_on_dormer',
      parentId: 'dormer_123',
      wallId: 'dormer_123',
      width: 1.5,
      height: 1.2,
      position: [1, 1.5, 0],
    })

    const dormerMock = {
      id: 'dormer_123',
      type: 'dormer',
    }

    const scene = {
      get: (id: string) => (id === 'dormer_123' ? dormerMock : undefined),
      nodes: () => ({ [dormerMock.id]: dormerMock as any }),
    }

    const handles =
      typeof windowDefinition.handles === 'function'
        ? windowDefinition.handles(window, scene as any)
        : (windowDefinition.handles ?? [])

    for (const handle of handles as any[]) {
      if (typeof handle.max === 'function') {
        expect(() => handle.max(window, scene as any)).not.toThrow()
      }
    }
  })
})
