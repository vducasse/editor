declare module 'polygon-clipping' {
  export type Pair = [number, number]
  export type Ring = Pair[]
  export type Polygon = Ring[]
  export type MultiPoly = Polygon[]
  export type Geom = Polygon | MultiPoly

  export function union(poly1: Geom, ...polys: Geom[]): MultiPoly
  export function intersection(poly1: Geom, ...polys: Geom[]): MultiPoly
  export function xor(poly1: Geom, ...polys: Geom[]): MultiPoly
  export function difference(poly1: Geom, ...polys: Geom[]): MultiPoly

  const polygonClipping: {
    union: typeof union
    intersection: typeof intersection
    xor: typeof xor
    difference: typeof difference
  }

  export default polygonClipping
}
