import { staticAttrValue } from './staticAttrValue.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/* A component's slotted children split by destination slot. */
export type SlotGroups = {
    default: TemplateNode[]
    named: { name: string; nodes: TemplateNode[] }[]
}

/*
Partitions a component's children by their `slot="name"` attribute: an element
carrying one goes to that named group (with the directive attr stripped so it
never renders as a real attribute), everything else forms the default slot. Both
back-ends partition identically, so SSR and client agree on which markup lands in
which `<slot>`.
*/
export function partitionSlots(children: TemplateNode[]): SlotGroups {
    const defaults: TemplateNode[] = []
    const named = new Map<string, TemplateNode[]>()
    for (const child of children) {
        const name = child.kind === 'element' ? staticAttrValue(child, 'slot') : undefined
        if (child.kind !== 'element' || name === undefined) {
            defaults.push(child)
            continue
        }
        const stripped = {
            ...child,
            attrs: child.attrs.filter((attr) => !(attr.kind === 'static' && attr.name === 'slot')),
        }
        named.set(name, [...(named.get(name) ?? []), stripped])
    }
    return {
        default: defaults,
        named: [...named].map(([name, nodes]) => ({ name, nodes })),
    }
}
