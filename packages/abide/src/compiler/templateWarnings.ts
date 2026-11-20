import type { CheckerAnswer } from './CheckerAnswer.ts'
import type { Read } from './classifyRead.ts'
import { isComponentTag } from './classifyTemplate.ts'
import { type Diagnosis, diagnosisAt } from './Diagnostics.ts'
import { isNamedAlone } from './isNamedAlone.ts'
import { Lowering } from './Lowering.ts'
import type { AbideFile } from './parseAbide.ts'
import {
    type Body,
    fileBody,
    type ForBlock,
    holdsNode,
    type TemplateNode,
    visitBodies,
} from './TemplateNode.ts'

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
 * A template's warnings: each unkeyed `{#for}` over a changing subject whose body holds state, and
 * each `{#for}` subject that falls back to an empty list where nothing has landed.
 *
 * 32.14 — see `STATEFUL`. 32.97 — see `fallsBackEmpty`; `others` are the checker's warnings, so a
 * `??` 14.17 already warns on is not warned on twice.
 */
export function templateWarnings(
    path: string,
    text: string,
    file: AbideFile,
    answer: CheckerAnswer,
    others: readonly Diagnosis[] = [],
): Diagnosis[] {
    const lowering = new Lowering(file, answer)
    const warnings: Diagnosis[] = []
    const check = (body: Body): void => {
        for (const node of body.children) {
            if (node.kind !== 'block' || node.block !== 'for') continue
            const fallback = fallsBackEmpty(node, lowering)
            if (fallback !== undefined) {
                const at = diagnosisAt(
                    path,
                    text,
                    file.origins.holders.get(node) ?? 0,
                    'warning',
                    `abide: \`${node.subject.trim()}\` falls back to an empty list, and a {#for} over a subject that has not landed already iterates zero times. Write {#for ${node.item} of ${fallback}}. RULEBOOK 32.22, 32.97.`,
                )
                if (!citedAt(others, at, '14.17')) warnings.push(at)
            }
            if (
                node.key === '' &&
                holdsNode(node.children, holdsState) &&
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
    }
    // Not the `<head>`: it is applied as markup each time it changes (39.1), so no row in it keeps
    // state for a reorder to hand to another item.
    visitBodies(fileBody(file), undefined, check)
    return warnings
}

// `x.ready() ? x : []` or `ready(x) ? x : []`, and `x || []` or `x ?? []` — what 32.22 already is.
const READY_OR_EMPTY =
    /^(?:([\w$.]+)\.ready\(\)|ready\(([\w$.]+)\))\s*\?\s*([\w$.]+)\s*:\s*\[\s*\]$/
const OR_EMPTY = /^([\w$.]+)\s*(?:\|\||\?\?)\s*\[\s*\]$/

/**
 * The subject a `{#for}` means where it falls back to an empty list over a reactive read, or
 * `undefined` where it does not.
 *
 * 32.97 — a subject that has not landed already iterates zero times (32.22), so the fallback is the
 * subject itself, written twice.
 */
function fallsBackEmpty(
    node: ForBlock,
    lowering: Lowering,
): string | undefined {
    const subject = node.subject.trim()
    const ready = READY_OR_EMPTY.exec(subject)
    if (ready !== null) {
        const read = ready[1] ?? ready[2]
        return read === ready[3] ? read : undefined
    }
    const or = OR_EMPTY.exec(subject)
    return or !== null && lowering.holdsRead(node) ? or[1] : undefined
}

/** Whether a diagnosis in `others` stands where `at` does and cites `clause`. */
function citedAt(
    others: readonly Diagnosis[],
    at: Diagnosis,
    clause: string,
): boolean {
    for (const other of others)
        if (
            other.path === at.path &&
            other.line === at.line &&
            other.column === at.column &&
            other.message.includes(`RULEBOOK ${clause}`)
        )
            return true
    return false
}

function holdsState(node: TemplateNode): boolean {
    if (node.kind !== 'element') return false
    if (isComponentTag(node.tag) || STATEFUL.has(node.lowerTag)) return true
    for (const attribute of node.attributes)
        if (attribute.lowerName.startsWith('bind:')) return true
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
