import type { Read } from './classifyRead.ts'
import { isComponentTag } from './classifyTemplate.ts'
import { Lowering } from './Lowering.ts'
import { isNamedAlone } from './isNamedAlone.ts'
import { diagnosisAt } from './lineOf.ts'
import type { AbideFile } from './parseAbide.ts'
import {
    childListsOf,
    componentsOf,
    type InlineComponent,
    type TemplateNode,
} from './TemplateNode.ts'
import type { Diagnosis } from './TypeSession.ts'

// 32.14 — A `{#for}` WITH NO KEY OVER A BODY THAT HOLDS STATE. Unkeyed, a row is matched to the
// item at its index, so a reorder hands one row's state — a component's own values, a field's text,
// an open `<details>` — to another item. Nothing about the page shows it until someone edits a row.
//
// STATE is what a row keeps that its item does not say: a component, a `bind:`, and the elements a
// browser keeps state in on its own. And only over a subject that can CHANGE: one that reads a
// `Reactive` or calls something that might. `{#for title of LIBRARY}` over a constant never
// reorders, and a warning there is one an author learns to skip.
const STATEFUL = new Set([
    'input',
    'select',
    'textarea',
    'details',
    'dialog',
    'video',
    'audio',
    'iframe',
    'canvas',
])

/**
 * A template's warnings: each unkeyed `{#for}` over a changing subject whose body holds state.
 *
 * 32.14 — see `STATEFUL`.
 */
export function templateWarnings(
    path: string,
    text: string,
    file: AbideFile,
    reads: readonly Read[],
): Diagnosis[] {
    // Built only once a block needs asking: most files hold no unkeyed stateful `{#for}`.
    let lowering: Lowering | undefined
    const loweringOf = (): Lowering => {
        lowering ??= new Lowering(file, reads)
        return lowering
    }
    const warnings: Diagnosis[] = []
    const walk = (
        nodes: TemplateNode[],
        components: readonly InlineComponent[],
    ): void => {
        for (const component of components)
            walk(component.children, component.components)
        for (const node of nodes) {
            if (
                node.kind === 'block' &&
                node.block === 'for' &&
                node.key === '' &&
                holdsState(node.children) &&
                canChange(node, loweringOf(), reads) &&
                !keyedByValue(node, node.subject.trim(), loweringOf(), reads)
            ) {
                const at = file.origins.holders.get(node) ?? 0
                warnings.push(
                    diagnosisAt(
                        path,
                        text,
                        at,
                        'warning',
                        `abide: this {#for} has no key and its body holds state, so a reorder hands one row's state to another item. Name what tells two items apart with \`by\`: {#for ${node.item} of ${node.subject} by …}, or \`by\` on the value it walks. RULEBOOK 32.14, 32.32.`,
                    ),
                )
            }
            for (const children of childListsOf(node)) walk(children, [])
            walk([], componentsOf(node))
        }
    }
    walk(file.template, file.components)
    return warnings
}

function holdsState(nodes: TemplateNode[]): boolean {
    for (const node of nodes) {
        if (node.kind === 'element') {
            if (isComponentTag(node.tag) || STATEFUL.has(node.lowerTag))
                return true
            for (const attribute of node.attributes)
                if (attribute.lowerName.startsWith('bind:')) return true
        }
        for (const children of childListsOf(node))
            if (holdsState(children)) return true
    }
    return false
}

function canChange(
    node: TemplateNode,
    lowering: Lowering,
    reads: readonly Read[],
): boolean {
    if (!lowering.isLive(node)) return false
    const span = lowering.projection.slots.get(node)
    if (span === undefined) return true
    if (lowering.projection.text.slice(span.start, span.end).includes('('))
        return true
    for (const read of reads)
        if (read.start >= span.start && read.start < span.end) return true
    return false
}

/**
 * Whether a `{#for}` subject is a name alone whose `reactive` declares `by`, keying it by value.
 *
 * 32.32 — such a subject IS KEYED, by the value rather than the block. The checker has already said
 * which names that is (`Read.byValue`), through an import as well as in the page's own setup.
 */
function keyedByValue(
    node: TemplateNode,
    subject: string,
    lowering: Lowering,
    reads: readonly Read[],
): boolean {
    if (!isNamedAlone(subject)) return false
    const span = lowering.projection.slots.get(node)
    if (span === undefined) return false
    for (const read of reads)
        if (read.byValue && read.start >= span.start && read.start < span.end)
            return true
    return false
}
