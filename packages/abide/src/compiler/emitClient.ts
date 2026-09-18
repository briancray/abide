import { lowerNames } from './lowerNames.ts'
import type { AbideFile } from './parseAbide.ts'
import { planTemplate, type TextRun } from './planTemplate.ts'
import { RUNTIME_SPECIFIER, SHARED_SPECIFIER } from './SPECIFIERS.ts'
import { splitImports } from './splitImports.ts'

// The client half of one `.abide`. It reads the SAME plan the server emitter did, so the position
// the server wrote to and the position the client walks to cannot drift.
//
// NOTHING IS ADDED TO THE DOCUMENT to make this work. A text run and a listener element are both
// reached by walking child indices from the region root, which is exact for a region whose shape
// is static — and a compiled template's is, up to the boundaries where 32.13, 32.14 and 32.16
// make it depend on a value. Those boundaries are where a marker will earn its place; nowhere
// before them does.
//
// 41.7 — hydration re-executes the setup, so the values the client starts from are the values the
// document was rendered with.

export function emitClient(
    file: AbideFile,
    reactive: ReadonlySet<string> = new Set(),
): string {
    const plan = planTemplate(
        file.template.filter(
            (node) => !(node.kind === 'element' && node.tag === 'head'),
        ),
    )
    const live = plan.runs.filter((run) => readsReactive(run, reactive))
    if (live.length === 0 && plan.handlers.length === 0) return ''

    const setup = splitImports(lowerNames(file.scripts.join('\n'), reactive))
    const lines: string[] = []

    // THE SHARED WALK, EMITTED ONCE. Walking from the region root per binding is O(bindings x
    // depth) — measured at 13x a marker walk on a tree 32 deep, and flat against depth once the
    // prefix every binding shares is walked a single time. The compiler holds every path, so the
    // prefix is free to compute and the emitted code is one line shorter per level.
    const prefix = commonPrefix([
        ...live.map((run) => run.path),
        ...plan.handlers.map((handler) => handler.path),
    ])
    const base = prefix.length === 0 ? 'root' : 'base'
    if (prefix.length > 0)
        lines.push(`const base = childAt(root, ${JSON.stringify(prefix)})`)
    const from = (path: number[]): string =>
        JSON.stringify(path.slice(prefix.length))

    for (const run of live) {
        // THE RUN IS WRITTEN WHOLE. Its static parts are literals and its expressions are read
        // live, so a change to any one of them recomputes the string and writes the single text
        // node the browser actually has. One `data` write, and no node invented to separate them.
        const value = run.parts
            .map((part) =>
                part.kind === 'static'
                    ? JSON.stringify(part.text)
                    : `escapeless(${lowerNames(part.text, reactive)})`,
            )
            .join(' + ')
        lines.push(
            `watch(() => setText(textAt(${base}, ${from(run.path)}), ${value}))`,
        )
    }

    // 32.5 — a native listener on the element itself.
    for (const handler of plan.handlers)
        lines.push(
            `elementAt(${base}, ${from(handler.path)}).addEventListener(${JSON.stringify(
                handler.event,
            )}, ${lowerNames(handler.source, reactive)})`,
        )

    const runtime: string[] = []
    if (live.length > 0) runtime.push('escapeless', 'setText', 'textAt')
    if (plan.handlers.length > 0) runtime.push('elementAt')
    if (prefix.length > 0) runtime.push('childAt')

    const watchImport =
        live.length > 0 ? `import { watch } from '${SHARED_SPECIFIER}'\n` : ''
    return `${watchImport}import { ${runtime.sort().join(', ')} } from '${RUNTIME_SPECIFIER}'
${setup.imports}
export default function mount(root) {
${indent(setup.body)}
${indent(lines.join('\n'))}
}
`
}

// Whether any expression in the run reads a name the checker called reactive. A run of static
// parts and unreactive expressions is written once by the server and never again; opening a
// binding for it is one waking reader per run on a page for nothing.
function readsReactive(run: TextRun, reactive: ReadonlySet<string>): boolean {
    for (const part of run.parts) {
        if (part.kind !== 'expression') continue
        if (lowerNames(part.text, reactive) !== part.text) return true
    }
    return false
}

// The longest run of child indices every binding's path begins with. A region with one binding
// has its whole parent path in common, which is the case that benefits most.
function commonPrefix(paths: number[][]): number[] {
    const first = paths[0]
    if (first === undefined) return []
    let length = first.length
    for (const path of paths) {
        let at = 0
        while (at < length && at < path.length && path[at] === first[at])
            at += 1
        length = at
    }
    // The LAST index of a binding's own path is the node it binds, never a shared ancestor: a
    // region with a single binding would otherwise hoist the walk all the way onto the node and
    // leave `textAt` checking the kind of something it was handed rather than something it found.
    return first.slice(0, Math.min(length, first.length - 1))
}

function indent(text: string): string {
    const lines = text.split('\n')
    let out = ''
    for (const line of lines) out += line.trim() === '' ? '\n' : `    ${line}\n`
    return out.trimEnd()
}
