import type { SlotDeclaration } from '@pascal-app/core'

export type SlabSlotId = 'surface' | 'side' | 'bottom'

// Declared default appearances for an unpainted slab in colored mode — a
// catalog `library:<id>` finish or a `#rrggbb` colour. Textures-off collapses
// all to the themed floor role (the escape hatch).
//
// `surface` (top face) keeps the wood floor default and the slot id used before
// the split, so existing painted slabs keep their floor finish. `side`
// (vertical outer edge) defaults to a light grey / exterior wall match so a slab's edges
// blend into the facade or read as a distinct trim. `bottom` (underside ceiling)
// defaults to a clean white ceiling finish.
export const SLAB_TOP_SLOT_DEFAULT = 'library:wood-woodplank48'
export const SLAB_SIDE_SLOT_DEFAULT = '#cccccc'
export const SLAB_BOTTOM_SLOT_DEFAULT = '#ffffff'

/**
 * A slab exposes three paintable faces: the top floor surface, the vertical
 * outer edges, and the underside ceiling.
 */
export function slabSlots(): SlotDeclaration[] {
  return [
    { slotId: 'surface', label: 'Top / Floor', default: SLAB_TOP_SLOT_DEFAULT },
    { slotId: 'side', label: 'Edge', default: SLAB_SIDE_SLOT_DEFAULT },
    { slotId: 'bottom', label: 'Ceiling', default: SLAB_BOTTOM_SLOT_DEFAULT },
  ]
}
