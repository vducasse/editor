# Slab ↔ Roof Intersection Algorithm (`fitSlabPolygonToRoof`)

Complete technical specification for clipping a slab (`SlabNode`) to fit inside the 3D roof volume by computing the horizontal cross-section of the roof mesh at the slab's altitude.

---

## 1. Coordinate Systems and Geometric Conventions

### Three.js 3D Coordinate System (Right-Handed)
- `X` : West (-) to East (+)
- `Y` : Altitude / Vertical Height (Ground = 0, Up = +Y)
- `Z` : North (-) to South / Front Facade (+Z)

### Pascal 2D Plan System (`polygon: [number, number][]`)
- `X` (1st coordinate) : West (-) to East (+)
- `Y` (2nd coordinate) : Front Facade / Dormer (`+Y`) to Back Facade / Plain Slope (`-Y`)
- **Strict Mapping** : $X_{2D} = X_{3D}$ and $Y_{2D} = Z_{3D}$ ($+Z_{3D} \rightarrow +Y_{2D}$).

---

## 2. Algorithm: Mesh Cross-Section

Instead of computing the slab boundary from a simplified 2D formula (which fails on complex roofs like cross gables), we **slice the actual 3D roof faces** with a horizontal plane at the slab's world elevation.

### 2.1. Collect 3D Mathematical Faces

`getRoofModuleFaces()` (in `@pascal-app/core`, pure math, no Three.js objects generated during logic) returns the mathematical 3D faces of a roof segment as polygons `{x, y, z}[][]`. These are exactly the same theoretical surfaces the GPU uses to generate triangles. 

For each `roof-segment` AND `dormer` in the scene:
1. Call `getRoofModuleFaces()` with the node's parameters.
2. Query `sceneRegistry.nodes.get(id).matrixWorld` to grab the exact, fully-resolved absolute world transformation of the node directly from the engine. This perfectly captures nested parent hierarchies, group offsets, and cascaded rotations without manual coordinate math.
3. Transform each vertex of the mathematical faces using `.applyMatrix4(matrixWorld)`.

### 2.2. Cut Each Face by the Horizontal Plane

For the slab at absolute world elevation $Y_{slab}$:

For each edge $(V_1, V_2)$ of each face:
- If both vertices are on the same side of the plane → no intersection
- Otherwise, compute the intersection point by linear interpolation:

$$P_{intersect} = V_1 + \frac{Y_{slab} - V_1.y}{V_2.y - V_1.y} \cdot (V_2 - V_1)$$

Each face that straddles the plane produces exactly one line segment $(P_a, P_b)$.

### 2.3. Chain Segments into Closed Contours

The collection of segments forms the boundary of the cross-section. Chain them end-to-end (matching endpoints within an epsilon tolerance) to produce a closed 2D solid contour for that specific node.

### 2.4. Boolean Union

Because a scene can have intersecting nodes (e.g. a `roof-segment` and a `dormer` that extends outward), the individual solid contours are merged using a true Boolean union algorithm (`polygon-clipping`). This ensures that overlapping solid footprint regions cleanly dissolve into a single continuous outer boundary.

### 2.5. Convert to Pascal 2D Plan Coordinates

Apply the standard 3D→2D mapping: $[X_{3D}, Z_{3D}] \rightarrow [X_{2D}, Y_{2D}]$.

The resulting polygon is simplified to remove colinear vertices, and becomes the new `slab.polygon`.

---

## 3. Why This Replaces the Previous Formula-Based Algorithm

The previous algorithm computed a single `ySlopeOffset` using `tan(pitch)` and hardcoded a dormer notch. This:
- Failed on cross gables (the formula didn't know about intersecting roof volumes)
- Failed on multi-segment roofs (only considered one segment)
- Required manual coding for each roof shape

The mesh cross-section approach:
- Works with **any** roof geometry (the faces already encode all shapes)
- Uses `getRoofModuleFaces` for both main roofs AND dormers, unifying their logic.
- Requires **no fragile manual coordinate math** (exact `matrixWorld` positions are pulled from the scene registry)
- Extracts clean mathematical edges, bypassing the CSG artifacts of the GPU shell meshes.
- Solves overlaps elegantly via a solid Boolean union.

---

## 4. Absolute Elevation Resolution

The slab's absolute elevation is resolved via `getLevelElevations(nodes)`:

$$Y_{slab}^{abs} = \text{baseY}_{slabLevel} + \text{slab.elevation}$$

The cutting plane simply slices through the transformed world faces at $Y = Y_{slab}^{abs}$.

---

## 5. Implementation Location

- **Source**: `packages/nodes/src/slab/fit-to-roof.ts`
- **Tests**: `packages/nodes/src/slab/fit-to-roof.test.ts`
- **Called from**: `packages/nodes/src/slab/panel.tsx` → `handleFitToRoof`
