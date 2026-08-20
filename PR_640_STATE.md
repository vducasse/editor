# PR #640: Sloped Wall & Opening Parity State

This file records the exact state of PR #640 (`feat/wall-end-height`) so any new session/agent picks up immediately without losing context.

## Current State
- **Branch**: `feat/wall-end-height`
- **Latest committed push**: `e7b4a532`
- **Working tree fixes**:
  - `packages/nodes/src/door/door-math.ts` (door/window clamp parity fix)
  - `packages/nodes/src/door/door-math.test.ts` (new door clamp tests)
  - `packages/nodes/src/window/window-math.test.ts` (new window clamp tests)
  - Line ending and format normalization across touched files
- **Tests**: All 2,700 unit tests pass (`bun test packages/nodes packages/core packages/editor packages/viewer`).
- **Linter**: Biome check clean on all touched packages.

## The Fix for the Last BugBot Finding
BugBot reported:
> "When a door is wider than its host wall, clampToWall sets fits to false but leaves clampedX as width / 2, which lies past the wall end whenever minX > maxX. Window clamping centers at wallLength / 2 in the same case, so door previews can sit off-wall despite the claimed parity fix."

In `packages/nodes/src/door/door-math.ts`, the early check for `width > wallLength` is now at the top of `clampToWall` (line 59), returning `{ clampedX: wallLength / 2, clampedY: height / 2, fits: false }` to achieve 100% parity with `packages/nodes/src/window/window-math.ts`.

## To Stage & Push When Ready:
```bash
git add packages/nodes/src/door/door-math.ts packages/nodes/src/door/door-math.test.ts packages/nodes/src/window/window-math.test.ts
git commit --amend --no-edit
git push my-fork feat/wall-end-height --force-with-lease
```
