// The app's build, READ — for the cases that need one to exist and are not about making one.
//
// `abide start` serves what `abide build` left in `.abide/client`, so a case about starting needs an
// artifact and has no opinion about how it got there. Both of the files that do — `start.test.ts` and
// `mount.test.ts` — used to spawn a build of their own in `beforeAll`, which was free while `bun test`
// ran one file at a time and is a race the moment it does not: a build begins by removing the whole
// directory, so two of them against one app root leave the other file serving from an empty one.
//
// `build.test.ts` is the file that BUILDS, and it does it in a copy of its own for the same reason.
// So the artifact this reads is nobody's to rewrite while the suite runs, and it is made ONCE, by the
// gate, before any of them start.

import { type ClientManifest, MANIFEST_FILE } from 'abide/cli'
import { APP_ROOT } from './PATHS.ts'

/**
 * The manifest the app was last built to, or a failure that says how to get one.
 *
 * Thrown rather than built on demand: two files ask, they run as separate processes, and "build it if
 * it is missing" is the same race in a politer shape.
 */
export async function builtManifest(): Promise<ClientManifest> {
    const file = Bun.file(`${APP_ROOT}/${MANIFEST_FILE}`)
    if (!(await file.exists())) {
        throw new Error(
            `the dogfood app is not built — run \`bun run build\` first. ${MANIFEST_FILE} is what \`abide start\` serves from, and the gate builds it before the suite.`,
        )
    }
    return (await file.json()) as ClientManifest
}
