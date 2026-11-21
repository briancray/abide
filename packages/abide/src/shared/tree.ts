// 51.84-51.91 — WAI-ARIA's tree, as parts an app spreads onto elements of its own: the tree, an item per
// node, and the group holding a node's children. The keys rove the items that show — a collapsed
// node's children are not among them — and the server writes every attribute, so the page is the
// tree as it stands before it hydrates.

import { checkParts } from './checkParts.ts'
import { randomToken } from './randomToken.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { roving, typeahead } from './roving.ts'

/** The nodes, how each is told apart and named, and which are open and picked. */
export type TreeOptions<Node> = {
    /** The top level's nodes, in the order they render; a function is read live. */
    roots: readonly Node[] | (() => readonly Node[])
    /** A node's children, in order; none, or an empty list, for a leaf. */
    children(node: Node): readonly Node[] | undefined
    /** What tells one node from another. */
    key(node: Node): string
    /** The text a node is found by as letters are typed. */
    label(node: Node): string
    /** The keys of the nodes expanded: hand it a `Reactive` to read and set them. None by default. */
    expanded?: Reactive<readonly string[]>
    /** The key of the node picked: hand it a `Reactive` to read and set the pick. */
    selected?: Reactive<string | undefined>
}

/** The parts `tree` hands back, each spread onto an element: `<li {...view.item(node)}>`. */
export type Tree<Node> = {
    /** The tree's attributes and its keyboard. */
    readonly tree: Record<string, unknown>
    /** A node's attributes and its click. */
    item(node: Node): Record<string, unknown>
    /** The attributes of the element holding a node's children, hidden while it is collapsed. */
    group(node: Node): Record<string, unknown>
    /** Whether a node is expanded. */
    isExpanded(node: Node): boolean
    /** Expands a collapsed node, or collapses an expanded one. */
    toggle(node: Node): void
}

// Where a node stands: its depth from 1, how many siblings it has counting itself, its place among
// them from 1, its parent's key, and whether it has children.
type Placed = {
    level: number
    setsize: number
    posinset: number
    parent: string | undefined
    branch: boolean
}

/** WAI-ARIA's tree: nested nodes the keys rove and expand, as parts to spread. */
export function tree<Node>(options: TreeOptions<Node>): Tree<Node> {
    const { roots, children, key, label } = options
    const rootsOf = typeof roots === 'function' ? roots : () => roots
    const expanded = options.expanded ?? reactive<readonly string[]>([])
    const selected = options.selected ?? reactive<string | undefined>(undefined)
    const typedTo = typeahead()

    // EVERY NODE PLACED, and the ones that show in order: one walk, again only when the nodes or what
    // is expanded change.
    const walked = reactive(() => {
        const open = new Set(expanded())
        const placed = new Map<string, Placed>()
        const shown: string[] = []
        const labels: string[] = []
        const walk = (
            nodes: readonly Node[],
            level: number,
            parent: string | undefined,
            showing: boolean,
        ): void => {
            for (let index = 0; index < nodes.length; index += 1) {
                const node = nodes[index] as Node
                const each = key(node)
                const below = children(node) ?? []
                placed.set(each, {
                    level,
                    setsize: nodes.length,
                    posinset: index + 1,
                    parent,
                    branch: below.length > 0,
                })
                if (showing) {
                    shown.push(each)
                    labels.push(label(node))
                }
                walk(below, level + 1, each, showing && open.has(each))
            }
        }
        walk(rootsOf(), 1, undefined, true)
        return { placed, shown, labels, open }
    })

    // 51.86 — the item in the page's tab order: the one focused last, else the one picked, else the first.
    const focused = reactive<string | undefined>(undefined)
    const current = reactive((): string | undefined => {
        const { shown } = walked()
        for (const wanted of [focused(), selected()])
            if (wanted !== undefined && shown.includes(wanted)) return wanted
        return shown[0]
    })

    const base = `tree-${randomToken(4, 'hex')}`
    const itemId = (each: string) => `${base}-${encodeURIComponent(each)}`
    if (process.env.NODE_ENV !== 'production') checkParts('tree', base)
    const focus = (each: string): void => {
        focused.set(each)
        globalThis.document?.getElementById(itemId(each))?.focus()
    }
    const setOpen = (each: string, open: boolean): void => {
        const now = expanded.peek() ?? []
        if (now.includes(each) === open) return
        expanded.set(open ? [...now, each] : now.filter((one) => one !== each))
    }

    const root = {
        role: 'tree',
        onkeydown: (event: KeyboardEvent) => {
            const { placed, shown, labels, open } = walked()
            // The item the key was pressed in, read off the event, so focus put there by any means counts.
            const within = (event.target as Element | null)?.closest?.(
                '[role=treeitem]',
            )
            const at =
                within === null || within === undefined
                    ? shown.indexOf(current() as string)
                    : shown.findIndex((one) => itemId(one) === within.id)
            const each = shown[at]
            const place = each === undefined ? undefined : placed.get(each)
            // 51.87 — Up and Down rove the items that show, stopping at the ends; Home and End.
            let to = roving(
                event.key,
                'vertical',
                () => [at, shown.length],
                false,
            )
            if (to === -1 && each !== undefined && place !== undefined) {
                // 51.88 — Right opens a closed branch, then enters it; Left closes an open one, then
                // climbs to its parent.
                if (event.key === 'ArrowRight' && place.branch) {
                    if (!open.has(each)) setOpen(each, true)
                    else to = at + 1
                } else if (event.key === 'ArrowLeft') {
                    if (place.branch && open.has(each)) setOpen(each, false)
                    else if (place.parent !== undefined)
                        to = shown.indexOf(place.parent)
                } else if (event.key === 'Enter' || event.key === ' ')
                    selected.set(each)
                // 51.89 — a printable key moves to the next item whose label starts with what was typed.
                else
                    to = typedTo(event, at, shown.length, (index) =>
                        String(labels[index]),
                    )
                if (
                    to === -1 &&
                    !['ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(
                        event.key,
                    )
                )
                    return
            }
            event.preventDefault()
            const next = shown[to]
            if (next !== undefined) focus(next)
        },
    }

    const item = (node: Node): Record<string, unknown> => {
        const each = key(node)
        const place = () => walked().placed.get(each)
        return {
            role: 'treeitem',
            id: itemId(each),
            get 'aria-level'() {
                return place()?.level
            },
            get 'aria-setsize'() {
                return place()?.setsize
            },
            get 'aria-posinset'() {
                return place()?.posinset
            },
            // 51.85 — a branch says whether it is open; a leaf says nothing.
            get 'aria-expanded'() {
                if (place()?.branch !== true) return undefined
                return walked().open.has(each) ? 'true' : 'false'
            },
            get 'aria-selected'() {
                return selected() === each ? 'true' : 'false'
            },
            get tabindex() {
                return current() === each ? '0' : '-1'
            },
            get 'data-selected'() {
                return selected() === each ? '' : undefined
            },
            // 51.86 — focus put on an item by any means makes it the one in the tab order.
            onfocus: () => focused.set(each),
            // 51.90 — a click picks the item it lands in, and not the branches holding it.
            onclick: (event: MouseEvent) => {
                const hit = (event.target as Element | null)?.closest?.(
                    '[role=treeitem]',
                )
                if (
                    hit !== null &&
                    hit !== undefined &&
                    hit.id !== itemId(each)
                )
                    return
                selected.set(each)
                focus(each)
            },
        }
    }

    // 51.91 — a branch's children are hidden while it is collapsed.
    const group = (node: Node): Record<string, unknown> => {
        const each = key(node)
        return {
            role: 'group',
            get hidden() {
                return !walked().open.has(each)
            },
        }
    }

    return {
        tree: root,
        item,
        group,
        isExpanded: (node) => walked().open.has(key(node)),
        toggle: (node) => {
            const each = key(node)
            setOpen(each, !(expanded.peek() ?? []).includes(each))
        },
    }
}
