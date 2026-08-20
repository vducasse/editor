import type { SceneMaterial, SceneMaterialId, SlotDeclaration, StairNode } from '@pascal-app/core'
import {
  type RenderShading,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
} from '@pascal-app/viewer'
import type * as THREE from 'three'

export type StairSlotId = 'treads' | 'body' | 'railing'

export const STAIR_TREADS_SLOT_DEFAULT = 'library:wood-woodplank48'
export const STAIR_BODY_SLOT_DEFAULT = 'library:preset-lightgrey'
export const STAIR_RAILING_SLOT_DEFAULT = 'library:metal-steel'

export function stairSlots(node: StairNode): SlotDeclaration[] {
  const slots: SlotDeclaration[] = [
    { slotId: 'treads', label: 'Treads', default: STAIR_TREADS_SLOT_DEFAULT },
    { slotId: 'body', label: 'Body', default: STAIR_BODY_SLOT_DEFAULT },
  ]

  if (node.railingMode && node.railingMode !== 'none') {
    slots.push({ slotId: 'railing', label: 'Railing', default: STAIR_RAILING_SLOT_DEFAULT })
  }

  return slots
}

function hasMaterialSpec(material: unknown, materialPreset: unknown): boolean {
  return material !== undefined || typeof materialPreset === 'string'
}

function hasLegacyStairSlotMaterial(node: StairNode, slotId: StairSlotId): boolean {
  const hasWhole = hasMaterialSpec(node.material, node.materialPreset)
  const hasTread = hasMaterialSpec(node.treadMaterial, node.treadMaterialPreset)
  const hasSide = hasMaterialSpec(node.sideMaterial, node.sideMaterialPreset)
  const hasRailing = hasMaterialSpec(node.railingMaterial, node.railingMaterialPreset)

  if (slotId === 'treads') return hasTread || hasSide || hasWhole
  if (slotId === 'body') return hasSide || hasTread || hasWhole
  return hasRailing || hasTread || hasSide || hasWhole
}

export function resolveStairSlotMaterial(
  node: StairNode,
  slotId: StairSlotId,
  defaultRef: string,
  baseMaterial: THREE.Material,
  sceneMaterials: Record<SceneMaterialId, SceneMaterial> | undefined,
  shading: RenderShading,
  textures: boolean,
): THREE.Material {
  if (!textures) return baseMaterial

  const slotMaterial = resolveMaterialRef(node.slots?.[slotId], sceneMaterials, shading)
  if (slotMaterial) return slotMaterial

  if (hasLegacyStairSlotMaterial(node, slotId)) return baseMaterial

  return resolveSlotDefaultMaterial(defaultRef, shading)
}

