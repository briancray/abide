import type { AppLayout, PlacedSource } from './appLayout.ts'
import { checkedShadow, moduleConfigShadow } from './checkedShadow.ts'
import {
    byPlace,
    type Diagnosis,
    type Finding,
    placedFindings,
} from './Diagnostics.ts'
import { lineOf } from './lineOf.ts'
import { LoweredFile } from './LoweredFile.ts'
import { CHECKED_VALUES } from './Lowering.ts'
import { projectShadow } from './projectShadow.ts'
import type { ReadSource } from './readSources.ts'
import { routesDeclaration } from './routesDeclaration.ts'
import type { ShadowEdit, ShadowHost } from './ShadowHost.ts'
import { ShadowMap } from './ShadowMap.ts'

/** One source a diagnosis lowers: read, placed where it is a page or a layout, and maybe quiet. */
export type DiagnosedSource = Omit<ReadSource, 'quiet'> &
    Partial<Pick<PlacedSource, 'kind' | 'route'>> & {
        quiet?: boolean
    }

/**
 * The checker's diagnostics for each `.abide` source and the app's `.ts` roots, and each source's
 * lowering.
 *
 * 38.3 — WHAT THE CHECKER SAYS ABOUT EACH FILE AS IT RUNS, placed on the `.abide` line. Each
 * source is checked as its lowered program (`checkedShadow`), which is registered for the life
 * of the host beside its shadow for the reason a shadow is; and every `.ts` root of the
 * project under the app's root is checked as it stands, where `scripts` asks for them — an editor
 * asking about one page does not want the whole app. `sources` carry their text, which is what
 * a position is a line of. A `quiet` source is lowered and not reported on: a component an
 * editor's page imports, which is there for the props the page is held to (33.4).
 *
 * `app` is the app the sources are checked in (`appLayout`): its route table, which `url`'s
 * literal is held to (30.26), and its handler files, which type `Config` (27.13). A source placed
 * as a page or a layout carries its `kind` and `route`, which its `route.params` is typed by (23.9).
 *
 * `refused` is the path of every source whose checked lowering refused, which `diagnoses` has
 * reported at its line — `abide check` emits the rest of the app without them. `lowered` is each
 * source's lowering, which the host keeps for an editor's questions about it (`LoweredFile`) —
 * none where the checker opened no project.
 */
export async function diagnoseSources(
    host: ShadowHost,
    sources: readonly DiagnosedSource[],
    app: Pick<AppLayout, 'root' | 'addresses' | 'handlers' | 'routes'>,
    scripts: boolean,
): Promise<{
    diagnoses: Diagnosis[]
    refused: Set<string>
    lowered: LoweredFile[]
}> {
    const within = app.root
    const edit: ShadowEdit = { created: [], changed: [] }
    const checked: {
        source: DiagnosedSource
        map: ShadowMap
        refusals: readonly Finding[]
    }[] = []
    for (const source of sources) {
        const shadow = checkedShadow(
            source.file,
            source.answer,
            (source.kind === 'page' || source.kind === 'layout') &&
                source.route !== undefined
                ? { route: source.route, kind: source.kind }
                : undefined,
        )
        const map = new ShadowMap(
            host.canonical(source.path),
            projectShadow(source.file).origins,
            shadow.origins,
        )
        host.write(map.checkedPath, shadow.text, edit)
        // 23.19 — a package's page an editor opens is reported on, so its checked module is a
        // root of the project as its shadow is (`reactiveReads`).
        if (!source.quiet) host.openOutside(source.path, map.checkedPath, edit)
        checked.push({ source, map, refusals: shadow.refusals })
    }
    // 34.6 — WHAT THE BUNDLER RESOLVES AND THE CHECKER CANNOT: a stylesheet imported for its
    // effect, and (34.21) markdown imported as text into a `.ts`, which bun's own types leave
    // out where they declare `.txt`. Declared in a file of its own at the app's root, which is
    // a script, because a pattern module can only be declared outside a module.
    host.write(
        `${host.canonical(within)}/${AMBIENT}`,
        AMBIENT_DECLARATIONS,
        edit,
    )
    // 27.13 — what a handler file defaults, beside it.
    for (const handler of app.handlers) {
        const at = `${host.canonical(handler.path)}${CONFIG_SUFFIX}`
        const shadow = handler.hooks.includes('onConfig')
            ? moduleConfigShadow(handler.text)
            : undefined
        // One that stops filing keeps its place and declares nothing, so the next snapshot is
        // told it moved.
        if (shadow !== undefined || host.holds(at))
            host.write(at, shadow ?? 'export {}\n', edit)
    }
    // 30.26 — THE APP'S ROUTE TABLE, which `url`'s literal is held to: every page the build
    // routes, declared into abide's own `Routes`. A module rather than a script, since only a
    // module augments one.
    host.write(
        `${host.canonical(within)}/${ROUTES_DECLARATION}`,
        routesDeclaration(app.addresses, app.routes),
        edit,
    )
    const refused = new Set<string>()
    for (const { source, refusals } of checked)
        if (refusals.length > 0) refused.add(source.path)
    const answered = await host.ask(
        async (project) => {
            const program = project.program
            // `path` is the file the author wrote, which for a checked module is not the file asked.
            const report = async (
                asked: string,
                path: string,
                place: (position: number) => { line: number; column: number },
            ): Promise<Diagnosis[]> => {
                const [syntactic, semantic] = await Promise.all([
                    program.getSyntacticDiagnostics(asked),
                    program.getSemanticDiagnostics(asked),
                ])
                const said: Diagnosis[] = []
                for (const diagnostic of [...syntactic, ...semantic])
                    said.push({
                        path,
                        ...place(diagnostic.pos),
                        code: diagnostic.code,
                        category: CATEGORIES[diagnostic.category] ?? 'error',
                        // A checked module's own names are the lowering's, and read as the author's.
                        message: flatten(diagnostic).replaceAll(
                            `${CHECKED_VALUES}.`,
                            '',
                        ),
                    })
                return said
            }
            const reports: Promise<Diagnosis[]>[] = []
            const refusing: Diagnosis[] = []
            const lowered: LoweredFile[] = []
            for (const { source, map, refusals } of checked) {
                const lowering = new LoweredFile(host, source.text, map)
                host.keep(lowering)
                lowered.push(lowering)
                if (source.quiet) continue
                // A refusal is at a projection offset (`Lowering.refusals`).
                refusing.push(
                    ...placedFindings(
                        source.path,
                        source.text,
                        refusals,
                        (at) => map.toSource(map.shadowPath, at),
                        'error',
                    ),
                )
                reports.push(
                    report(map.checkedPath, source.path, (position) =>
                        lineOf(
                            source.text,
                            map.toSource(map.checkedPath, position),
                        ),
                    ),
                )
            }
            const standing = scripts ? host.rootsUnder(project, within) : []
            for (const path of standing)
                if (!host.holds(path))
                    reports.push(
                        Bun.file(path)
                            .text()
                            .then((text) =>
                                report(path, path, (position) =>
                                    lineOf(text, position),
                                ),
                            ),
                    )
            const reported = [
                ...refusing,
                ...(await Promise.all(reports)).flat(),
            ]
            reported.sort(byPlace)
            // A component's props type is checked twice — in its `props` call and in what a tag is
            // held to (`checkedShadow`) — and both copies place a finding in it at the one place
            // written.
            const diagnoses: Diagnosis[] = []
            const placed = new Set<string>()
            for (const diagnosis of reported) {
                const key = `${diagnosis.path}:${diagnosis.line}:${diagnosis.column}:${diagnosis.code}:${diagnosis.message}`
                if (placed.has(key)) continue
                placed.add(key)
                diagnoses.push(diagnosis)
            }
            return { diagnoses, lowered }
        },
        { edit },
    )
    return {
        diagnoses: answered?.diagnoses ?? [],
        refused,
        lowered: answered?.lowered ?? [],
    }
}

const AMBIENT = 'abide-check.d.ts'
const ROUTES_DECLARATION = 'abide-routes.d.ts'
const AMBIENT_DECLARATIONS = `declare module '*.css' {}
declare module '*.md' {
    const text: string
    export default text
}
`

/** What a module that is no `.abide` is checked beside as, for the `Config` it files (27.13). */
const CONFIG_SUFFIX = '.config-shadow.ts'

/** Indexed by the API's `DiagnosticCategory`. */
const CATEGORIES = ['warning', 'error', 'suggestion', 'message'] as const

function flatten(diagnostic: {
    text: string
    messageChain?:
        readonly { text: string; messageChain?: unknown }[] | undefined
}): string {
    let message = diagnostic.text
    const chain = diagnostic.messageChain ?? []
    for (const link of chain)
        message += `\n  ${flatten(link as Parameters<typeof flatten>[0]).replaceAll('\n', '\n  ')}`
    return message
}
