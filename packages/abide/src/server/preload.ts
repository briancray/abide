// 38.109 — `@abide/abide/test`, PRELOADED BY `bun test`: the app's compilation served before any test
// file is loaded, so a test imports a `.abide` as any module — beside the code it tests, at the top
// of the file, with no `createApp` run first. Bun loads every import of a file before it evaluates
// any, so registering the compilation from inside a test is always too late; a preload is the
// one place that runs first. The build is `createApp`'s own under `bun test` (42.16), so a test that
// boots the app afterwards reuses it rather than building twice.

import { appRoot, servedBuild } from './createApp.ts'

const root = appRoot(undefined)
// A run from a directory that holds no app — a workspace's root — preloads nothing.
// Fresh whatever `NODE_ENV` says: `bun test` sets it only where nothing else has.
if (root !== undefined) await servedBuild(root, true)

export { type Mounted, mount } from './testMount.ts'
