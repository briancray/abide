import type { TemplateNode } from './TemplateNode.ts'

// ONE walk, consulted by BOTH emitters. The server writes the markers and the client counts
// them, so the two have to agree on the order and the numbering exactly; computing that twice —
// once per emitter, over the same tree — is two walks that agree until the day one of them
// gains a case. Keyed by node IDENTITY so a lookup cannot drift from a count.

export type TemplatePlan = {
    // Expression slots in document order. The index is the marker's number.
    slotIndex: Map<TemplateNode, number>
    slots: string[]
    // Elements carrying at least one `on<event>` handler, and what to bind on them.
    elementIndex: Map<TemplateNode, number>
    handlers: { element: number; event: string; source: string }[]
}

export function planTemplate(template: TemplateNode[]): TemplatePlan {
    const plan: TemplatePlan = {
        slotIndex: new Map(),
        slots: [],
        elementIndex: new Map(),
        handlers: [],
    }
    walk(template, plan)
    return plan
}

function walk(nodes: TemplateNode[], plan: TemplatePlan): void {
    for (const node of nodes) {
        if (node.kind === 'expression') {
            plan.slotIndex.set(node, plan.slots.length)
            plan.slots.push(node.source)
            continue
        }
        if (node.kind !== 'element') continue

        for (const attribute of node.attributes) {
            if (!attribute.expression || !isEventName(attribute.name)) continue
            let element = plan.elementIndex.get(node)
            if (element === undefined) {
                element = plan.elementIndex.size
                plan.elementIndex.set(node, element)
            }
            // 32.5 — `on<event>` binds a NATIVE listener on an element. The event is the name
            // with `on` taken off, lowercased, so `onClick` and `onclick` are one event.
            plan.handlers.push({
                element,
                event: attribute.name.slice(2).toLowerCase(),
                source: attribute.value,
            })
        }
        walk(node.children, plan)
    }
}

function isEventName(name: string): boolean {
    return name.length > 2 && name.startsWith('on')
}
