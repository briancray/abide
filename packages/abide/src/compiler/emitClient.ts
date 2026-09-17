import { lowerNames } from './lowerNames.ts'
import type { AbideFile } from './parseAbide.ts'
import { planTemplate } from './planTemplate.ts'
import { RUNTIME_SPECIFIER, SHARED_SPECIFIER } from './SPECIFIERS.ts'
import { splitImports } from './splitImports.ts'

// The client half of one `.abide`. It reads the SAME plan the server emitter did, so the marker
// the server wrote and the slot the client counts cannot drift: the numbering is looked up, not
// recomputed.
//
// 41.7 — hydration re-executes the setup. The `<script>` body is the same text the server ran, so
// the values the client starts from are the values the document was rendered with.

export function emitClient(
    file: AbideFile,
    reactive: ReadonlySet<string> = new Set(),
): string {
    const plan = planTemplate(
        file.template.filter(
            (node) => !(node.kind === 'element' && node.tag === 'head'),
        ),
    )
    if (plan.slots.length === 0 && plan.handlers.length === 0) return ''

    const setup = splitImports(lowerNames(file.scripts.join('\n'), reactive))
    const lines: string[] = []

    if (plan.slots.length > 0) lines.push('const slotNodes = slots(root)')
    if (plan.handlers.length > 0)
        lines.push('const handlerNodes = handlers(root)')

    for (let at = 0; at < plan.slots.length; at += 1) {
        const source = lowerNames(plan.slots[at] as string, reactive)
        // A slot that reads nothing reactive is WRITTEN ONCE by the server and never again. Not
        // opening a watch for it is the difference between one waking reader on a page and one
        // per slot; the gate beside this counts them.
        if (!readsReactive(plan.slots[at] as string, reactive)) continue
        lines.push(`watch(() => setText(slotNodes[${at}], ${source}))`)
    }

    for (const handler of plan.handlers) {
        // 32.5 — a native listener on the element itself.
        lines.push(
            `handlerNodes[${handler.element}].addEventListener(${JSON.stringify(
                handler.event,
            )}, ${lowerNames(handler.source, reactive)})`,
        )
    }

    const needsWatch = lines.some((line) => line.startsWith('watch('))
    const runtime: string[] = []
    if (plan.slots.length > 0) runtime.push('setText', 'slots')
    if (plan.handlers.length > 0) runtime.push('handlers')

    const watchImport = needsWatch
        ? `import { watch } from '${SHARED_SPECIFIER}'\n`
        : ''
    return `${watchImport}import { ${runtime
        .sort()
        .join(', ')} } from '${RUNTIME_SPECIFIER}'
${setup.imports}
export default function mount(root) {
${indent(setup.body)}
${indent(lines.join('\n'))}
}
`
}

// Whether an expression reads a name the checker called reactive. The lowering already knows how
// to find them, so asking it is cheaper than a second scanner pass and cannot disagree with it.
function readsReactive(source: string, reactive: ReadonlySet<string>): boolean {
    return lowerNames(source, reactive) !== source
}

function indent(text: string): string {
    const lines = text.split('\n')
    let out = ''
    for (const line of lines) out += line.trim() === '' ? '\n' : `    ${line}\n`
    return out.trimEnd()
}
