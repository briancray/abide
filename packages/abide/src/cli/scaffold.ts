// `abide scaffold <name>` — copy the starter package into a fresh project.
//
// A MODULE rather than a function body inside `main.ts`, for the reason `build.ts` states: `main.ts`
// is the CLI DISPATCHER and this is a project-writing step, so the dispatcher's argv parsing has no
// business being on the path that reads a template.

import { join } from 'node:path'

// The single default starter (CL1.2) lives as a real, dogfooded workspace package — `packages/starter`
// — so it type-checks, lints, and runs like any authored app instead of hiding in code as strings.
// `scaffold` copies its `src/` + the root files below verbatim, swapping only the app name and the
// `workspace:*` abide dep for a published range. Resolved relative to this file: `src/cli` → up three
// → `packages/`.
const STARTER_DIR = join(import.meta.dir, '../../../starter')

// Root-level template files copied verbatim. NAMED rather than globbed, because the template dir also
// holds the monorepo-only e2e harness (`playwright.config.ts`, `e2e/`, `scripts/`) that cannot ship in
// a scaffolded app — see the package.json stripping below.
//
// `.gitignore` is load-bearing, not tidiness: `scaffold` runs `git init` (unless `--no-git`), so
// without one the first `git add .` in a fresh app commits `node_modules/`, `dist/`, and the GENERATED
// `src/.abide/health.d.ts` — which the whole health-companion design (CO2.4) assumes is regenerated,
// never tracked. That invariant held in this monorepo only via the ROOT `.gitignore`, which no
// scaffolded app ever sees.
// `README.md` rides along for the same reason: it is the only thing in a fresh app that says what the
// scripts are and where files go, and a scaffolded project has no monorepo around it to infer that from.
const STARTER_ROOT_FILES = ['tsconfig.json', '.gitignore', 'README.md'] as const

// Copy the starter package into a fresh `name/` project. Returns the project root.
export async function scaffold(dir: string, name: string): Promise<string> {
    const root = join(dir, name)

    // The whole src/ tree verbatim (skip any generated `.abide` output if the template was ever built).
    const srcDir = join(STARTER_DIR, 'src')
    const glob = new Bun.Glob('**/*')
    for await (const relative of glob.scan({ cwd: srcDir, onlyFiles: true, dot: true })) {
        if (relative.startsWith('.abide/')) continue
        await Bun.write(join(root, 'src', relative), Bun.file(join(srcDir, relative)))
    }

    // tsconfig + .gitignore verbatim; package.json rewritten with the app name + a published abide range.
    for (const file of STARTER_ROOT_FILES) {
        await Bun.write(join(root, file), Bun.file(join(STARTER_DIR, file)))
    }
    const pkg = await Bun.file(join(STARTER_DIR, 'package.json')).json()
    pkg.name = name
    if (pkg.dependencies?.abide) pkg.dependencies.abide = '^0.0.0'
    // The Playwright e2e harness (playwright.config, e2e/, scripts/serve-e2e) is monorepo-only
    // dogfooding of the template — serve-e2e imports abide by workspace path and can't ship in an app.
    // Its files live outside src/ (never copied); strip the matching scripts + dep from the output.
    delete pkg.scripts?.e2e
    delete pkg.scripts?.['e2e:ci']
    delete pkg.devDependencies?.['@playwright/test']
    await Bun.write(join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

    return root
}
