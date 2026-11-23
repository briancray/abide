// 49.8 — A PARTS FUNCTION'S STRUCTURE, CHECKED WHILE DEVELOPING. Parts leave the markup to the app, so
// what a component used to guarantee — an `aria-controls` naming an element that is there, an option
// inside its listbox — is the app's to get right, and this names what it got wrong. Every part a parts
// function writes an id on, or names one from, carries the function's own id prefix, so the check
// finds them by it rather than by elements handed to it.
//
// DEVELOPMENT ONLY, AND GONE FROM A BUILD: every caller writes `if (process.env.NODE_ENV !==
// 'production') checkParts(…)`, which the client bundle's `define` folds to `if (false)` under `abide
// build` (36.16), so the call and, with no other importer, this module are dropped.

import { namedLogger } from './log.ts'

const PARTS_LOG = namedLogger('abide:parts')

// The attributes naming other elements by id, any of which a part may write.
const REFERENCES = [
    'aria-controls',
    'aria-labelledby',
    'aria-describedby',
    'aria-activedescendant',
    'aria-owns',
] as const

// A role WAI-ARIA requires inside another, and the one it requires.
const REQUIRED_PARENT: Record<string, string> = {
    option: 'listbox',
    tab: 'tablist',
    treeitem: 'tree',
    menuitem: 'menu',
    menuitemcheckbox: 'menu',
    menuitemradio: 'menu',
}

const CLOSED_DRAWN =
    "a closed popover is drawn: a display set on it outranks the browser's hiding of it, so set it behind :popover-open. RULEBOOK 49.16"

// Ids are random per call, so a problem is warned once by what it is, not by which element has it.
const warned = new Set<string>()

/** What is wrong with the parts written under `prefix` in `root`, each said once. */
export function partsProblems(prefix: string, root: ParentNode): string[] {
    const problems = new Set<string>()
    const quoted = JSON.stringify(prefix)
    for (const attribute of REFERENCES)
        for (const element of root.querySelectorAll(
            `[${attribute}*=${quoted}]`,
        ))
            for (const id of (element.getAttribute(attribute) ?? '').split(
                /\s+/,
            ))
                if (
                    id.startsWith(prefix) &&
                    element.ownerDocument.getElementById(id) === null
                )
                    problems.add(
                        `${attribute} names an element that is not there. RULEBOOK 49.8`,
                    )
    for (const element of root.querySelectorAll(`[id^=${quoted}]`)) {
        const role = element.getAttribute('role') ?? ''
        const parent = REQUIRED_PARENT[role]
        if (
            parent !== undefined &&
            element.parentElement?.closest(`[role=${parent}]`) === null
        )
            problems.add(
                `a ${role} stands outside any ${parent}. RULEBOOK 49.8`,
            )
    }
    for (const popover of popoversOf(prefix, root))
        if (rendersClosed(popover)) problems.add(CLOSED_DRAWN)
    return [...problems]
}

// 49.16 — the popover each part written under `prefix` is or sits in.
function popoversOf(prefix: string, root: ParentNode): Set<Element> {
    const found = new Set<Element>()
    for (const element of root.querySelectorAll(
        `[id^=${JSON.stringify(prefix)}]`,
    )) {
        const popover = element.closest('[popover]')
        if (popover !== null) found.add(popover)
    }
    return found
}

// An engine with no hiding of its own for a closed popover — a DOM emulator — draws every one, so
// it is asked once, of a bare popover, before any is blamed.
let enginesHide: boolean | undefined

/** Whether `popover` is closed and drawn all the same. */
function rendersClosed(popover: Element): boolean {
    if (popover.matches(':popover-open') || !popover.checkVisibility())
        return false
    if (enginesHide === undefined) {
        const bare = popover.ownerDocument.createElement('div')
        bare.setAttribute('popover', 'manual')
        popover.ownerDocument.body.append(bare)
        enginesHide = !bare.checkVisibility()
        bare.remove()
    }
    return enginesHide
}

/**
 * Warns on `abide:parts`, once a turn after the parts have been spread, of each structure problem
 * found under `prefix` — once per problem for the page. Development only: see the head of this file.
 *
 * @param name the parts function's name, which the warning opens with
 * @param prefix the prefix of every id the function writes
 */
export function checkParts(name: string, prefix: string): void {
    if (typeof document === 'undefined') return
    setTimeout(() => {
        for (const problem of partsProblems(prefix, document))
            warnOnce(name, problem)
    }, 0)
}

/**
 * 49.16 — warns on `abide:parts`, once a turn after it is bound, where `popover` — a popover part the
 * function holds by its element rather than by an id — is closed and drawn. Development only.
 */
export function checkPopover(name: string, popover: Element): void {
    setTimeout(() => {
        if (rendersClosed(popover)) warnOnce(name, CLOSED_DRAWN)
    }, 0)
}

function warnOnce(name: string, problem: string): void {
    const message = `${name}: ${problem}.`
    if (warned.has(message)) return
    warned.add(message)
    PARTS_LOG.warning(message)
}
