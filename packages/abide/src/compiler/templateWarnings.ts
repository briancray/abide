import type { CheckerAnswer } from './CheckerAnswer.ts'
import type { Read } from './classifyRead.ts'
import { isComponentTag } from './classifyTemplate.ts'
import { isNamedAlone } from './isNamedAlone.ts'
import { diagnosisAt } from './lineOf.ts'
import { Lowering } from './Lowering.ts'
import type { AbideFile } from './parseAbide.ts'
import {
    bodiesOf,
    type Body,
    type ForBlock,
    type TemplateNode,
    visitBodies,
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
    answer: CheckerAnswer,
): Diagnosis[] {
    const lowering = new Lowering(file, answer)
    const warnings: Diagnosis[] = []
    const check = (body: Body): void => {
        for (const node of body.children)
            if (
                node.kind === 'block' &&
                node.block === 'for' &&
                node.key === '' &&
                holdsState(node.children) &&
                canChange(node, lowering) &&
                !keyedByValue(node, lowering)
            )
                warnings.push(
                    diagnosisAt(
                        path,
                        text,
                        file.origins.holders.get(node) ?? 0,
                        'warning',
                        `abide: this {#for} has no key and its body holds state, so a reorder hands one row's state to another item. Name what tells two items apart with \`by\`: {#for ${node.item} of ${node.subject} by …}, or \`by\` on the value it walks. RULEBOOK 32.14, 32.32.`,
                    ),
                )
    }
    // Not the `<head>`: it is applied as markup each time it changes (39.1), so no row in it keeps
    // state for a reorder to hand to another item.
    visitBodies(
        {
            children: file.template,
            setup: null,
            style: null,
            components: file.components,
        },
        undefined,
        check,
    )
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
        for (const body of bodiesOf(node))
            if (holdsState(body.children)) return true
    }
    return false
}

/**
 * Whether a `{#for}` subject can reorder: live (`Lowering.isLive`), AND reading something or
 * calling something that might.
 *
 * NARROWER THAN LIVE, ON PURPOSE. Live is the binding's safe side — a subject nobody proved static
 * is watched — and a warning's safe side is the other one: an unproven subject that names no
 * `Reactive` and calls nothing, a constant the checker was not asked about or a file read with no
 * checker, cannot move, and a warning there is one an author learns to skip.
 */
function canChange(node: ForBlock, lowering: Lowering): boolean {
    if (!lowering.isLive(node)) return false
    return node.subject.includes('(') || lowering.holdsRead(node)
}

/**
 * Whether a `{#for}` subject is a name alone whose `reactive` declares `by`, keying it by value.
 *
 * 32.32 — such a subject IS KEYED, by the value rather than the block. The checker has already said
 * which names that is (`Read.byValue`), through an import as well as in the page's own setup.
 */
function keyedByValue(node: ForBlock, lowering: Lowering): boolean {
    return (
        isNamedAlone(node.subject.trim()) &&
        lowering.holdsRead(node, isKeyedByValue)
    )
}

function isKeyedByValue(read: Read): boolean {
    return read.byValue
}
