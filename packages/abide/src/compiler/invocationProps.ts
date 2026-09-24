// 32.18 — WHAT A COMPONENT INVOCATION HANDS ITS CHILD, as the entries of the props record both lanes
// write: one accessor per prop (33.4). Written once, because the server calls the child with this
// record and the browser mounts it with the same one, and two copies are two answers to what a tag
// passes.
//
// 32.11, 33.12, 33.13 — SPREADS FIRST, IN SOURCE ORDER, then every explicit prop: an explicit prop
// beats a spread whatever the order the author wrote them in, and two spreads resolve as written.
// 32.6, 33.7 — `bind:prop` passes the caller's own `Reactive`, which is the write path.

import type { Lowering } from './Lowering.ts'
import type { TemplateNode } from './TemplateNode.ts'

export function invocationProps(
    node: TemplateNode & { kind: 'element' },
    lowering: Lowering,
): string[] {
    const spreads: string[] = []
    const explicit: string[] = []
    for (const attribute of node.attributes) {
        if (attribute.name === '...') {
            spreads.push(
                `...${lowering.use('spreadProps')}(() => (${lowering.expression(attribute)}))`,
            )
            continue
        }
        if (attribute.lowerName.startsWith('bind:') && attribute.expression) {
            const name = attribute.name.slice('bind:'.length)
            explicit.push(
                `${JSON.stringify(name)}: () => (${lowering.reference(attribute)})`,
            )
            continue
        }
        if (attribute.name.includes(':'))
            throw new Error(
                `abide: ${attribute.name} on <${node.tag}> is not a prop a component takes — \`class:\` and \`style:\` set an element's own class and style. RULEBOOK 32.10.`,
            )
        // A STATIC PROP IS STILL AN ACCESSOR. One shape per prop whatever the call site spelled
        // (33.10), so the child reads every key the same way and a literal is not a second case.
        const value = attribute.expression
            ? lowering.expression(attribute)
            : JSON.stringify(attribute.value)
        explicit.push(`${JSON.stringify(attribute.name)}: () => (${value})`)
    }
    return [...spreads, ...explicit]
}
