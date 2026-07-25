import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCENARIOS as CORPUS } from '@abide/bench/scenarios'
import { GET } from 'abide/server/GET'
import { analyzeScope } from 'abide/ui/internal/analyzeScope'
import { emitModuleSource, loadEmittedServer } from 'abide/ui/internal/emit'
import { parse } from 'abide/ui/internal/parse'

// LIVE FRONTEND BENCH (browser side) — the client counterpart to `benchFrontend` (which times the pure
// SSR `render` string build). This ships the REAL browser hot paths to the page so the timing happens in
// the actual DOM: each `.abide` template in the corpus is AOT-emitted to its client module, the whole
// corpus is bundled ONCE into a self-contained browser ES module (runtime included a single time), and
// that module string — plus each scenario's server-rendered HTML — is handed to the page. The page
// blob-imports it and times three paths against a fresh detached host:
//   • mount    — build the live DOM from scratch
//   • hydrate  — attach to server-rendered HTML (first-load interactivity; runs over the same SSR markup
//                the server produced here, so it walks real hydration anchors, not a mount-shaped clone)
//   • update   — a reactive state change flushed to the DOM (the interactive `<button>` scenarios)
// This is the same measurement the CLI `bun run bench` makes with happy-dom, but in a genuine browser.
//
// The bundle also carries the hand-written `@abide/bench/vanillaBaselines` corpus, so the page can time
// `mount` and `update` against a framework-free equivalent of the same scenario in the same tab — the
// only way to tell abide's cost apart from the browser's own DOM cost. (`hydrate` has no vanilla analog:
// adopting server-rendered markup is a thing only a framework does.)

interface Scenario {
    name: string
    src: string
    // Element count for list scenarios — lets the page show ns/row for the mount pass.
    rows?: number
    // The scenario owns reactive state behind a `<button>`; the page times a click-driven DOM patch.
    update?: boolean
    // Server-render scope for the `hydrate` pass. Present on the pure-render scenarios (the interactive
    // ones need their own reactive-primitive instances and are covered by the `update` pass instead).
    serverScope?: () => Record<string, unknown>
}

// Derived from the shared `@abide/bench/scenarios` corpus (kept in lockstep with `benchFrontend` and the
// CLI runner, row-for-row, by construction). A render-able scenario (`server !== false`) carries its
// `scope` as the hydrate `serverScope`; an interactive scenario (has an `update` fn) is marked
// `update: true` and is driven by a real click in the browser (its reactive instances live on the page,
// so it needs no server scope). The corpus's update CLOSURES are for the CLI's happy-dom path and are not
// serializable to the browser — only the `update` marker crosses.
const SCENARIOS: Scenario[] = CORPUS.map((scenario) => ({
    name: scenario.name,
    src: scenario.src,
    ...(scenario.rows !== undefined ? { rows: scenario.rows } : {}),
    ...(scenario.update !== undefined ? { update: true } : {}),
    ...(scenario.server !== false ? { serverScope: scenario.scope } : {}),
}))

// Emitted client modules import the runtime as a bare specifier; rewrite it to an absolute path so
// Bun.build — running from a tmpdir entry outside the package — resolves it (same trick as
// `clientBundle.emitOne`). Resolved once per process.
const RUNTIME_PATH = Bun.resolveSync('abide/ui/internal/runtime', import.meta.dir)

// A `<script>`'s framework imports (`abide/shared/state`, …) are emitted as bare `abide/*` specifiers;
// Bun.build runs from a tmpdir entry outside the package, so rewrite each to its absolute path (same as
// `clientBundle.resolveModuleImports`). Template-only scenarios have no such imports (a no-op).
function resolveModuleImports(client: string, src: string): string {
    let out = client
    const seen = new Set<string>()
    for (const { specifier } of analyzeScope(parse(src)).moduleImports) {
        if (seen.has(specifier)) continue
        seen.add(specifier)
        const absolute = Bun.resolveSync(specifier, import.meta.dir)
        out = out.replaceAll(
            `from ${JSON.stringify(specifier)}`,
            `from ${JSON.stringify(absolute)}`,
        )
    }
    return out
}

export interface ClientBenchScenario {
    name: string
    rows: number | null
    update: boolean
    // Server-rendered SSR markup for the hydrate pass; null for the interactive (update-only) scenarios.
    html: string | null
}

export interface ClientBenchBundle {
    // A self-contained browser ES module (source text): `export const scenarios = { <name>: { mount,
    // hydrate }, … }` plus the bundle's own `state`/`watch`.
    js: string
    scenarios: ClientBenchScenario[]
}

// Emit every scenario's client module + a tiny entry that re-exports their `mount`/`hydrate` under a name
// map, then bundle the lot into ONE browser module (runtime inlined once, shared across all scenarios),
// and render each pure-render scenario's SSR HTML for the hydrate pass. Cached for the process — the
// corpus is fixed.
let bundlePromise: Promise<ClientBenchBundle> | undefined

async function buildBundle(): Promise<ClientBenchBundle> {
    const dir = join(tmpdir(), `abide-bench-client-${Bun.randomUUIDv7()}`)
    await mkdir(dir, { recursive: true })
    try {
        let entry = ''
        const map: string[] = []
        for (let i = 0; i < SCENARIOS.length; i++) {
            const scenario = SCENARIOS[i]!
            let client = emitModuleSource(scenario.src).client.replace(
                '"abide/ui/internal/runtime"',
                JSON.stringify(RUNTIME_PATH),
            )
            client = resolveModuleImports(client, scenario.src)
            const file = join(dir, `s${i}.ts`)
            await Bun.write(file, client)
            entry += `import { mount as m${i}, hydrate as h${i} } from ${JSON.stringify(file)}\n`
            map.push(`${JSON.stringify(scenario.name)}: { mount: m${i}, hydrate: h${i} }`)
        }
        entry += `export const scenarios = { ${map.join(', ')} }\n`
        // Re-export the bundle's OWN `state`/`watch` (a `<script>`'s `state` import is compiled to a
        // `$scope.state` read, so interactive scenarios get their reactive primitives from scope). These
        // must be the copies that share THIS bundle's runtime scheduler — the page's own `state` is a
        // separate module instance whose state the bundled effects would never track. The page passes
        // `mod.state`/`mod.watch` in the scope for update scenarios.
        entry += `export { state } from ${JSON.stringify(Bun.resolveSync('abide/shared/state', import.meta.dir))}\n`
        entry += `export { watch } from ${JSON.stringify(Bun.resolveSync('abide/shared/watch', import.meta.dir))}\n`
        // Ship the hand-written baselines into the SAME bundle so the page can time abide's `mount`/
        // `update` against a framework-free equivalent of the same scenario, back to back in one tab.
        // They are plain DOM code with no imports — the browser is their native habitat.
        entry += `export { VANILLA_BASELINES } from ${JSON.stringify(Bun.resolveSync('@abide/bench/vanillaBaselines', import.meta.dir))}\n`
        const entryPath = join(dir, 'entry.ts')
        await Bun.write(entryPath, entry)

        const result = await Bun.build({
            entrypoints: [entryPath],
            target: 'browser',
            minify: true,
        })
        if (!result.success) {
            const messages = result.logs.map((entry) => String(entry)).join('\n')
            throw new Error(`benchFrontendClient: bundle failed:\n${messages}`)
        }
        let js = ''
        for (const output of result.outputs) {
            if (output.kind === 'entry-point') js = await output.text()
        }
        if (js === '') throw new Error('benchFrontendClient: bundle produced no entry output.')

        // Render each pure-render scenario's SSR HTML (the hydrate pass replays it in the browser). The
        // interactive scenarios have no server scope — they are covered by the update pass.
        const scenarios: ClientBenchScenario[] = []
        for (const scenario of SCENARIOS) {
            const html = scenario.serverScope
                ? await (await loadEmittedServer(scenario.src)).render(scenario.serverScope())
                : null
            scenarios.push({
                name: scenario.name,
                rows: scenario.rows ?? null,
                update: scenario.update === true,
                html,
            })
        }

        return { js, scenarios }
    } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
}

export default GET((): Promise<ClientBenchBundle> => {
    if (bundlePromise === undefined) bundlePromise = buildBundle()
    return bundlePromise
})
