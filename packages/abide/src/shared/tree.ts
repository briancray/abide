// 51.77-51.84, 51.98-51.103, 51.156 — WAI-ARIA's tree, as parts an app spreads onto elements of its own: the tree, an item per
// node, and the group holding a node's children. The keys rove the items that show — a collapsed
// node's children are not among them — and the server writes every attribute, so the page is the
// tree as it stands before it hydrates.

import { checkParts } from './checkParts.ts'
import { hotkeys } from './hotkeys.ts'
import {
    type ItemKey,
    type KeyOf,
    keyOfItem,
    type KeyOption,
    type LabelOption,
    writtenBy,
} from './itemKey.ts'
import { type Live, live } from './live.ts'
import { randomToken } from './randomToken.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { roving, typeahead } from './roving.ts'
import { type Picked, Selection } from './Selection.ts'

/** The nodes, how each is told apart and named, and which are open and picked. */
export type TreeOptions<
    Node,
    Multiple extends boolean = false,
    Key extends ItemKey = KeyOf<Node>,
> = {
    /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
    id?: string | undefined
    /** The top level's nodes, in the order they render; a function is read live. */
    roots: Live<readonly Node[]>
    /** A node's children, in order; none, or an empty list, for a leaf. */
    children(node: Node): readonly Node[] | undefined
    /** The keys of the nodes expanded, where the app holds them: a `Reactive` to read and set. Held by the parts, none expanded, and handed back as `expanded`, where none is given. */
    expanded?: Reactive<readonly NoInfer<Key>[]> | undefined
    /** 51.98 — whether it selects many, each press changing the selection rather than replacing it. `false` by default. */
    multiple?: Multiple | undefined
    /** The key of the node picked, or every key picked where it selects many, where the app holds them: a `Reactive` to read and set. Held by the parts, and handed back as `selected`, where none is given. */
    selected?: Reactive<Picked<NoInfer<Key>, Multiple>> | undefined
} & KeyOption<Node, Key> &
    LabelOption<Node>

/** One node's parts: its item, the group holding its children, whether it is expanded, and the toggle. */
export type TreeNode = {
    /** The node's attributes and its click. */
    readonly item: Record<string, unknown>
    /** The attributes of the element holding the node's children, hidden while it is collapsed. */
    readonly group: Record<string, unknown>
    /** Whether the node is expanded. */
    get expanded(): boolean
    /** Expands the node where it is collapsed, or collapses it where it is expanded. */
    toggle(): void
}

/** The parts `tree` hands back, each spread onto an element: `<li {...view.node(node).item}>`. */
export type Tree<
    Node,
    Multiple extends boolean = false,
    Key extends ItemKey = KeyOf<Node>,
> = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** The tree's attributes and its keyboard. */
    readonly tree: Record<string, unknown>
    /** One node's parts. */
    node(node: Node): TreeNode
    /** The nodes that show, in order: each root, and the children of every expanded node that shows. */
    get shown(): readonly Node[]
    /** The keys of the nodes expanded, read and set. */
    readonly expanded: Reactive<readonly Key[]>
    /** The key of the node picked, or every key picked where it selects many, read and set. */
    readonly selected: Reactive<Picked<Key, Multiple>>
}

// Where a node stands: its depth from 1, how many siblings it has counting itself, its place among
// them from 1, its parent's key, and whether it has children.
type Placed = {
    level: number
    setsize: number
    posinset: number
    parent: ItemKey | undefined
    branch: boolean
}

/** WAI-ARIA's tree: nested nodes the keys rove and expand, as parts to spread. */
export function tree<
    Node,
    Multiple extends boolean = false,
    Key extends ItemKey = KeyOf<Node>,
>(options: TreeOptions<Node, Multiple, Key>): Tree<Node, Multiple, Key> {
    // 49.11 — read where they are used; whether it selects many is fixed for the life of the parts.
    const children = (node: Node) => options.children(node)
    // Keys are held as `ItemKey` inside, and as `Key` at the surface.
    const key = (node: Node): ItemKey =>
        keyOfItem(options.key as ((node: Node) => Key) | undefined, node)
    const label = (node: Node) => writtenBy(options.label, node)
    const rootsOf = () => live(options.roots)
    const expanded = (options.expanded ??
        reactive<readonly Key[]>([])) as Reactive<readonly ItemKey[]>
    const many = options.multiple === true
    const selection = new Selection(
        options.selected as Reactive<Picked<ItemKey, boolean>> | undefined,
        many,
    )
    const typedTo = typeahead()

    // EVERY NODE PLACED, and the ones that show in order: one walk, again only when the nodes or what
    // is expanded change.
    const walked = reactive(() => {
        const open = new Set(expanded())
        const placed = new Map<ItemKey, Placed>()
        const shown: ItemKey[] = []
        const shownNodes: Node[] = []
        const labels: string[] = []
        const walk = (
            nodes: readonly Node[],
            level: number,
            parent: ItemKey | undefined,
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
                    shownNodes.push(node)
                    labels.push(label(node))
                }
                walk(below, level + 1, each, showing && open.has(each))
            }
        }
        walk(rootsOf(), 1, undefined, true)
        return { placed, shown, shownNodes, labels, open }
    })

    // 51.79 — the item in the page's tab order: the one focused last, else the first one picked, else
    // the first.
    const focused = reactive<ItemKey | undefined>(undefined)
    const current = reactive((): ItemKey | undefined => {
        const { shown } = walked()
        const wanted = focused()
        if (wanted !== undefined && shown.includes(wanted)) return wanted
        for (const each of selection.list())
            if (shown.includes(each)) return each
        return shown[0]
    })
    const shownKeys = () => walked().shown
    // 51.101 — every node, where it selects many.
    const selectAll = many
        ? hotkeys({
              'mod+a': () => selection.all(() => [...walked().placed.keys()]),
          })
        : undefined

    const base = options.id ?? `tree-${randomToken(4, 'hex')}`
    const itemId = (each: ItemKey) => `${base}-${encodeURIComponent(each)}`
    if (process.env.NODE_ENV !== 'production') checkParts('tree', base)
    const focus = (each: ItemKey): void => {
        focused.set(each)
        globalThis.document?.getElementById(itemId(each))?.focus()
    }
    const setOpen = (each: ItemKey, open: boolean): void => {
        const now = expanded.peek() ?? []
        if (now.includes(each) === open) return
        expanded.set(open ? [...now, each] : now.filter((one) => one !== each))
    }

    const root = {
        role: 'tree',
        'data-tree': 'tree',
        'aria-multiselectable': many ? 'true' : undefined,
        onkeydown: (event: KeyboardEvent) => {
            selectAll?.(event)
            const { placed, shown, labels, open } = walked()
            // The item the key was pressed in, read off the event, so focus put there by any means counts.
            const within = (event.target as Element | null)?.closest?.(
                '[role=treeitem]',
            )
            const at =
                within === null || within === undefined
                    ? shown.indexOf(current() as ItemKey)
                    : shown.findIndex((one) => itemId(one) === within.id)
            const each = shown[at]
            const place = each === undefined ? undefined : placed.get(each)
            // 51.80 — Up and Down rove the items that show, stopping at the ends; Home and End.
            let to = roving(
                event.key,
                'vertical',
                () => [at, shown.length],
                false,
            )
            // 51.103 — Shift carries the selection along with a move of Up, Down, Home or End.
            const extending = many && event.shiftKey && to !== -1
            if (to === -1 && each !== undefined && place !== undefined) {
                // 51.81 — Right opens a closed branch, then enters it; Left closes an open one, then
                // climbs to its parent.
                if (event.key === 'ArrowRight' && place.branch) {
                    if (!open.has(each)) setOpen(each, true)
                    else to = at + 1
                } else if (event.key === 'ArrowLeft') {
                    if (place.branch && open.has(each)) setOpen(each, false)
                    else if (place.parent !== undefined)
                        to = shown.indexOf(place.parent)
                } else if (event.key === 'Enter') selection.pick(each)
                // 51.102 — Space toggles where it selects many, and Shift+Space selects the run to it.
                else if (event.key === ' ') {
                    if (!many) selection.pick(each)
                    else if (event.shiftKey)
                        selection.extend(each, each, shownKeys)
                    else selection.toggle(each)
                }
                // 51.82 — a printable key moves to the next item whose label starts with what was typed.
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
            if (next === undefined) return
            if (extending && !selection.extend(each, next, shownKeys)) return
            focus(next)
        },
    }

    const item = (node: Node): Record<string, unknown> => {
        const each = key(node)
        const place = () => walked().placed.get(each)
        return {
            role: 'treeitem',
            'data-tree': 'item',
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
            // 51.78 — a branch says whether it is open; a leaf says nothing.
            get 'aria-expanded'() {
                if (place()?.branch !== true) return undefined
                return walked().open.has(each) ? 'true' : 'false'
            },
            // 49.17 — a leaf is never open.
            get 'data-open'() {
                return walked().open.has(each) && place()?.branch === true
                    ? ''
                    : undefined
            },
            get 'aria-selected'() {
                return selection.has(each) ? 'true' : 'false'
            },
            get tabindex() {
                return current() === each ? '0' : '-1'
            },
            get 'data-selected'() {
                return selection.has(each) ? '' : undefined
            },
            // 51.79 — focus put on an item by any means makes it the one in the tab order.
            onfocus: () => focused.set(each),
            // 51.83, 51.99 — a click picks the item it lands in, and not the branches holding it.
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
                if (selection.press(each, event, current.peek(), shownKeys))
                    focus(each)
            },
        }
    }

    // 51.84 — a branch's children are hidden while it is collapsed.
    const group = (node: Node): Record<string, unknown> => {
        const each = key(node)
        return {
            role: 'group',
            'data-tree': 'group',
            get hidden() {
                return !walked().open.has(each)
            },
        }
    }

    return {
        id: base,
        tree: root,
        node: (node) => {
            const each = key(node)
            return {
                item: item(node),
                group: group(node),
                get expanded() {
                    return walked().open.has(each)
                },
                toggle: () =>
                    setOpen(each, !(expanded.peek() ?? []).includes(each)),
            }
        },
        get shown() {
            return walked().shownNodes
        },
        expanded: expanded as Reactive<readonly Key[]>,
        selected: selection.selected as Reactive<Picked<Key, Multiple>>,
    }
}
