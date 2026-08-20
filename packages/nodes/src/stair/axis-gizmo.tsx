'use client'

import { useMemo } from 'react'
import * as THREE from 'three'

function makeLabelTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128)
    // Draw colored badge background
    ctx.beginPath()
    ctx.arc(64, 64, 52, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()

    // Draw text
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 64px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 64, 64)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export function StairAxisGizmo({ length = 2.0 }: { length?: number }) {
  const radius = 0.02
  const coneRadius = 0.06
  const coneLength = 0.2
  const cylinderLength = length - coneLength

  const { xTex, yTex, zTex } = useMemo(() => {
    return {
      xTex: typeof document !== 'undefined' ? makeLabelTexture('X', '#ef4444') : null,
      yTex: typeof document !== 'undefined' ? makeLabelTexture('Y', '#22c55e') : null,
      zTex: typeof document !== 'undefined' ? makeLabelTexture('Z', '#3b82f6') : null,
    }
  }, [])

  return (
    <group name="stair-axis-gizmo">
      {/* X Axis - Red */}
      <group>
        <mesh position={[cylinderLength / 2, 0, 0]} rotation-z={-Math.PI / 2}>
          <cylinderGeometry args={[radius, radius, cylinderLength, 16]} />
          <meshBasicMaterial color="#ef4444" depthTest={false} transparent opacity={0.9} />
        </mesh>
        <mesh position={[length - coneLength / 2, 0, 0]} rotation-z={-Math.PI / 2}>
          <coneGeometry args={[coneRadius, coneLength, 16]} />
          <meshBasicMaterial color="#ef4444" depthTest={false} transparent opacity={0.9} />
        </mesh>
        {xTex && (
          <sprite position={[length + 0.25, 0, 0]} scale={[0.4, 0.4, 0.4]}>
            <spriteMaterial map={xTex} depthTest={false} transparent opacity={0.95} />
          </sprite>
        )}
      </group>

      {/* Y Axis - Green */}
      <group>
        <mesh position={[0, cylinderLength / 2, 0]}>
          <cylinderGeometry args={[radius, radius, cylinderLength, 16]} />
          <meshBasicMaterial color="#22c55e" depthTest={false} transparent opacity={0.9} />
        </mesh>
        <mesh position={[0, length - coneLength / 2, 0]}>
          <coneGeometry args={[coneRadius, coneLength, 16]} />
          <meshBasicMaterial color="#22c55e" depthTest={false} transparent opacity={0.9} />
        </mesh>
        {yTex && (
          <sprite position={[0, length + 0.25, 0]} scale={[0.4, 0.4, 0.4]}>
            <spriteMaterial map={yTex} depthTest={false} transparent opacity={0.95} />
          </sprite>
        )}
      </group>

      {/* Z Axis - Blue */}
      <group>
        <mesh position={[0, 0, cylinderLength / 2]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[radius, radius, cylinderLength, 16]} />
          <meshBasicMaterial color="#3b82f6" depthTest={false} transparent opacity={0.9} />
        </mesh>
        <mesh position={[0, 0, length - coneLength / 2]} rotation-x={Math.PI / 2}>
          <coneGeometry args={[coneRadius, coneLength, 16]} />
          <meshBasicMaterial color="#3b82f6" depthTest={false} transparent opacity={0.9} />
        </mesh>
        {zTex && (
          <sprite position={[0, 0, length + 0.25]} scale={[0.4, 0.4, 0.4]}>
            <spriteMaterial map={zTex} depthTest={false} transparent opacity={0.95} />
          </sprite>
        )}
      </group>
    </group>
  )
}
