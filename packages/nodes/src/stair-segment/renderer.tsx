'use client'

import {
  type AnyNodeId,
  type StairNode,
  type StairSegmentNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  getStairBodyMaterials,
  getStraightStairSegmentBodyMaterials,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { createPlaceholderGeometry } from '../shared/placeholder-geometry'
import {
  resolveStairSlotMaterial,
  STAIR_BODY_SLOT_DEFAULT,
  STAIR_TREADS_SLOT_DEFAULT,
} from '../stair/slots'

export const StairSegmentRenderer = ({ node }: { node: StairSegmentNode }) => {
  const ref = useRef<THREE.Mesh>(null!)
  const nodes = useScene((state) => state.nodes)
  const sceneMaterials = useScene((state) => state.materials)

  useRegistry(node.id, 'stair-segment', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'stair-segment')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset = useViewer((s) => s.colorPreset)
  const parentNode = node.parentId
    ? (nodes[node.parentId as AnyNodeId] as StairNode | undefined)
    : undefined

  const material = useMemo(() => {
    if (parentNode) {
      const baseBodyMaterials = getStairBodyMaterials(parentNode, shading, textures, colorPreset)
      return [
        resolveStairSlotMaterial(
          parentNode,
          'treads',
          STAIR_TREADS_SLOT_DEFAULT,
          baseBodyMaterials[0]!,
          sceneMaterials,
          shading,
          textures,
        ),
        resolveStairSlotMaterial(
          parentNode,
          'body',
          STAIR_BODY_SLOT_DEFAULT,
          baseBodyMaterials[1]!,
          sceneMaterials,
          shading,
          textures,
        ),
      ]
    }
    return getStraightStairSegmentBodyMaterials(node, parentNode, shading, textures, colorPreset)
  }, [
    shading,
    textures,
    colorPreset,
    node,
    parentNode,
    sceneMaterials,
  ])

  // 2 groups map 1:1 to the stair segment's 2-material array (body + tread).
  const placeholderGeometry = useMemo(() => createPlaceholderGeometry(2), [])

  useEffect(() => {
    return () => {
      placeholderGeometry.dispose()
    }
  }, [placeholderGeometry])

  return (
    <mesh
      geometry={placeholderGeometry}
      material={material}
      position={node.position}
      ref={ref}
      rotation-y={node.rotation}
      visible={node.visible}
      {...handlers}
    />
  )
}

export default StairSegmentRenderer
