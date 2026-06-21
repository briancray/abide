import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkAbide } from '../packages/abide/src/checkAbide.ts'

/*
Type-checks every `.abide` component in the example apps and the scaffold template
through its shadow program — the same pass `abide check` runs, against each app's
own tsconfig. The package `typecheck` script covers `packages/*` source but not
the examples; without this, an example calling the public API with a wrong option
name or a drifted signature compiles and ships clean (the surface is its own
dogfood). Wired into the release gate via the root `typecheck` script.
*/
const ROOT = resolve(import.meta.dir, '..')

/* Every example app, plus the scaffold template — each its own abide project. */
const examples = readdirSync(resolve(ROOT, 'examples'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `examples/${entry.name}`)
const targets = [...examples, 'packages/abide/template']

let errors = 0
for (const target of targets) {
    errors += await checkAbide({ cwd: resolve(ROOT, target) })
}
process.exit(errors === 0 ? 0 : 1)
