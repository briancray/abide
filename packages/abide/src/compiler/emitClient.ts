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
            `watch(() => setText(textAt(root, ${JSON.stringify(run.path)}), ${value}))`,
        )
    }

    // 32.5 — a native listener on the element itself.
    for (const handler of plan.handlers)
        lines.push(
            `elementAt(root, ${JSON.stringify(handler.path)}).addEventListener(${JSON.stringify(
                handler.event,
            )}, ${lowerNames(handler.source, reactive)})`,
        )

    const runtime: string[] = []
    if (live.length > 0) runtime.push('escapeless', 'setText', 'textAt')
    if (plan.handlers.length > 0) runtime.push('elementAt')

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

function indent(text: string): string {
    const lines = text.split('\n')
    let out = ''
    for (const line of lines) out += line.trim() === '' ? '\n' : `    ${line}\n`
    return out.trimEnd()
}
