'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type AttachmentSide,
  type StairSegmentNode,
  StairSegmentNode as StairSegmentNodeSchema,
  type StairSegmentType,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  ToggleControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'

const SEGMENT_TYPE_OPTIONS: { label: string; value: StairSegmentType }[] = [
  { label: 'Flight', value: 'stair' },
  { label: 'Landing', value: 'landing' },
  { label: 'Winder', value: 'winder' },
]

const ATTACHMENT_SIDE_OPTIONS: { label: string; value: AttachmentSide }[] = [
  { label: 'Front', value: 'front' },
  { label: 'Left', value: 'left' },
  { label: 'Right', value: 'right' },
]

const WINDER_TURN_OPTIONS: { label: string; value: AttachmentSide }[] = [
  { label: 'Left', value: 'left' },
  { label: 'Right', value: 'right' },
]

export default function StairSegmentPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as StairSegmentNode | undefined) : undefined,
  )

  // Boolean selector — re-renders only when this segment's position among the
  // parent stair's children flips to/from "first".
  const isFirstSegment = useScene((s) => {
    if (!node?.parentId) return true
    const parent = s.nodes[node.parentId as AnyNodeId]
    if (parent?.type !== 'stair') return true
    const children = (parent as any).children ?? []
    return children[0] === node.id
  })

  const handleUpdate = useCallback(
    (updates: Partial<StairSegmentNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleBack = useCallback(() => {
    if (node?.parentId) {
      setSelection({ selectedIds: [node.parentId] })
    }
  }, [node?.parentId, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!node?.parentId) return
    triggerSFX('sfx:item-pick')

    let duplicateInfo = structuredClone(node) as any
    delete duplicateInfo.id
    duplicateInfo.metadata = { ...duplicateInfo.metadata, isNew: true }
    duplicateInfo.position = [
      duplicateInfo.position[0] + 1,
      duplicateInfo.position[1],
      duplicateInfo.position[2] + 1,
    ]

    try {
      const duplicate = StairSegmentNodeSchema.parse(duplicateInfo)
      useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
      setSelection({ selectedIds: [] })
      setMovingNode(duplicate)
    } catch (e) {
      console.error('Failed to duplicate stair segment', e)
    }
  }, [node, setSelection, setMovingNode])

  const handleMove = useCallback(() => {
    if (node) {
      triggerSFX('sfx:item-pick')
      setMovingNode(node)
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:item-delete')
    const parentId = node.parentId
    useScene.getState().deleteNode(selectedId as AnyNodeId)
    if (parentId) {
      useScene.getState().dirtyNodes.add(parentId as AnyNodeId)
      setSelection({ selectedIds: [parentId] })
    } else {
      setSelection({ selectedIds: [] })
    }
  }, [selectedId, node, setSelection])

  if (!(node && node.type === 'stair-segment' && selectedId)) return null

  return (
    <PanelWrapper
      icon="/icons/stairs.webp"
      onBack={handleBack}
      onClose={handleClose}
      title={node.name || 'Stair Segment'}
      width={300}
    >
      <PanelSection title="Type">
        <SegmentedControl
          onChange={(v) => {
            const updates: Partial<StairSegmentNode> = { segmentType: v }
            if (v === 'landing') {
              updates.height = 0
              updates.stepCount = 0
              updates.length = node.width ?? 1.0
            } else if (v === 'winder') {
              const stepCount = 3
              updates.stepCount = stepCount
              updates.length = node.width ?? 1.0
              const currentRiser = node.stepCount > 0 ? node.height / node.stepCount : 0.18
              updates.height =
                Math.round(Math.min(node.height > 0 ? node.height : 0.54, stepCount * currentRiser) * 100) /
                  100 || 0.54
              if (node.attachmentSide === 'front') {
                updates.attachmentSide = 'right'
              }
            } else {
              updates.height = node.height > 0.3 ? node.height : 2.5
              const stepCount = Math.max(2, Math.round(updates.height / 0.18))
              updates.stepCount = stepCount
              updates.length = Math.round(stepCount * 0.28 * 100) / 100
            }
            handleUpdate(updates)
          }}
          options={SEGMENT_TYPE_OPTIONS}
          value={node.segmentType}
        />
      </PanelSection>

      {node.segmentType === 'winder' ? (
        <PanelSection title="Turn Direction">
          <SegmentedControl
            onChange={(v) => handleUpdate({ attachmentSide: v })}
            options={WINDER_TURN_OPTIONS}
            value={node.attachmentSide === 'right' ? 'right' : 'left'}
          />
        </PanelSection>
      ) : (
        !isFirstSegment && (
          <PanelSection title="Attachment">
            <SegmentedControl
              onChange={(v) => handleUpdate({ attachmentSide: v })}
              options={ATTACHMENT_SIDE_OPTIONS}
              value={node.attachmentSide}
            />
          </PanelSection>
        )
      )}

      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          max={5}
          min={0.5}
          onChange={(v) => handleUpdate({ width: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label="Length"
          max={10}
          min={0.5}
          onChange={(v) => handleUpdate({ length: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.length * 100) / 100}
        />
        {node.segmentType === 'stair' && (
          <>
            <SliderControl
              label="Height"
              max={10}
              min={0.5}
              onChange={(v) => handleUpdate({ height: v })}
              precision={2}
              step={0.1}
              unit="m"
              value={Math.round(node.height * 100) / 100}
            />
            <SliderControl
              label="Steps"
              max={30}
              min={2}
              onChange={(v) => handleUpdate({ stepCount: Math.round(v) })}
              precision={0}
              step={1}
              unit=""
              value={node.stepCount}
            />
          </>
        )}
        {node.segmentType === 'winder' && (
          <>
            <SliderControl
              label="Rise"
              max={2}
              min={0.2}
              onChange={(v) => handleUpdate({ height: v })}
              precision={2}
              step={0.05}
              unit="m"
              value={Math.round(node.height * 100) / 100}
            />
            <SliderControl
              label="Winder Steps"
              max={6}
              min={2}
              onChange={(v) => handleUpdate({ stepCount: Math.round(v) })}
              precision={0}
              step={1}
              unit=""
              value={node.stepCount || 3}
            />
          </>
        )}
      </PanelSection>

      <PanelSection title="Structure">
        <div className="space-y-3">
          <ToggleControl
            checked={node.fillToFloor}
            label="Fill to floor"
            onChange={(checked) => handleUpdate({ fillToFloor: checked })}
          />
          {!node.fillToFloor && (
            <SliderControl
              label="Thickness"
              max={1}
              min={0.05}
              onChange={(v) => handleUpdate({ thickness: v })}
              precision={2}
              step={0.05}
              unit="m"
              value={Math.round((node.thickness ?? 0.25) * 100) / 100}
            />
          )}
        </div>
      </PanelSection>

      <PanelSection title="Position">
        <SliderControl
          label="X"
          max={50}
          min={-50}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        <SliderControl
          label="Y"
          max={50}
          min={-50}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[1] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[1] * 100) / 100}
        />
        <SliderControl
          label="Z"
          max={50}
          min={-50}
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[2] * 100) / 100}
        />
        <SliderControl
          label="Rotation"
          max={180}
          min={-180}
          onChange={(degrees) => {
            handleUpdate({ rotation: (degrees * Math.PI) / 180 })
          }}
          precision={0}
          step={1}
          unit="°"
          value={Math.round((node.rotation * 180) / Math.PI)}
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          <ActionButton
            label="-45°"
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation - Math.PI / 4 })
            }}
          />
          <ActionButton
            label="+45°"
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation + Math.PI / 4 })
            }}
          />
        </div>
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="Move" onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label="Duplicate"
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
