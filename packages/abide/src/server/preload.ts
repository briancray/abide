// 38.109 — `@abide/abide/test`, PRELOADED BY `bun test`: the app's compilation served before any test
// file is loaded, so a test imports a `.abide` as any module — beside the code it tests, at the top
// of the file, with no `createApp` run first. Bun loads every import of a file before it evaluates
// any, so registering the compilation from inside a test is always too late; a preload is the
// one place that runs first. The build is `createApp`'s own under `bun test` (42.16), so a test that
// boots the app afterwards reuses it rather than building twice.

import { addDerived } from './config.ts'
import { appRoot, servedBuild } from './createApp.ts'

// 38.120 — a sign-in seals under test where the app declared no secret: derived, so the app's
// `onConfig` default and the env both still win (27.2), where an env value would beat the default.
addDerived({ ABIDE_PRINCIPAL_SECRET: 'abide-test-principal-secret' })

const root = appRoot(undefined)
// A run from a directory that holds no app preloads nothing — nor from a workspace's root, whose
// packages' `.abide` files are each their own app's rather than one app laid out across them.
// Fresh whatever `NODE_ENV` says: `bun test` sets it only where nothing else has.
if (root !== undefined && !(await isWorkspaceRoot(root)))
    await servedBuild(root, true)

async function isWorkspaceRoot(directory: string): Promise<boolean> {
    const manifest = Bun.file(`${directory}/package.json`)
    if (!(await manifest.exists())) return false
    const json = (await manifest.json()) as { workspaces?: unknown }
    return json.workspaces !== undefined
}

export { type Mounted, mount } from './testMount.ts'
