import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs' // bun has no sync mkdtemp/mkdir/rm of its own
import { dirname } from 'node:path' // bun has no path helpers of its own

// WHERE AN EMITTED MODULE GOES TO BE IMPORTED. Not under `packages/abide`, and that is the whole
// point of the helper: `conventions.test.ts` globs `**/*.ts` there, so a temp module written
// beside the tests is scanned by the naming and seam rules — and, under `--parallel`, is deleted
// by its own worker while another worker is mid-glob. Both were real failures.
//
// Inside the REPO, though, so `abide` and `abide/runtime` resolve from the root node_modules the
// way an app's would.
const ROOT = new URL('../../../.test-modules/', import.meta.url).pathname

const made: string[] = []

export function temporaryModule(files: Record<string, string>): string {
    const dir = mkdtempSync(`${ROOT}m-`)
    made.push(dir)
    // A name may carry directories, so a caller can lay out a tree rather than a flat folder.
    for (const [name, text] of Object.entries(files)) {
        mkdirSync(dirname(`${dir}/${name}`), { recursive: true })
        writeFileSync(`${dir}/${name}`, text)
    }
    return dir
}

export function removeTemporaryModules(): void {
    for (const dir of made) rmSync(dir, { recursive: true, force: true })
    made.length = 0
}
