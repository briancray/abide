// The counting lane's own work gates. Every one of these is a contract about work
// rather than output, so nothing about the DOM this builds would move if the lane
// were wrong — each names the number it reports with the mechanism out.

import { expect, test } from 'bun:test'

import { gate } from '@abide/harness/gate'
import {
    measure,
    patchSet,
    PUBLISHED_WORK_KEY,
    publishedBy,
    type PublishedWork,
    time,
} from '@abide/harness/measure'

function row(): HTMLElement {
    const element = document.createElement('li')
    element.appendChild(document.createElement('span'))
    return element
}

test('a known-n mutation counts exactly n', () => {
    const list = document.createElement('ul')
    const rows = [row(), row(), row()]
    for (const one of rows) list.appendChild(one)
    // Two rows swapped: the minimal keyed reconcile's distinguishing case.
    const work = measure(() => {
        list.insertBefore(rows[2] as Node, rows[0] as Node)
        list.insertBefore(rows[0] as Node, rows[1] as Node)
    })
    expect(work.elementsMoved).toBe(2)
    expect(work.nodesCreated).toBe(0)
})

// Reverted to one `nodesMoved` total, 2 fields become 1 and the 25x case becomes
// invisible: moving a comment is 0.11 µs and moving an element with its subtree is
// 2.8 µs, because only the element is in the reflow.
test('moving a comment and moving an element land in different fields', () => {
    const parent = document.createElement('div')
    const marker = document.createComment('anchor')
    const element = document.createElement('span')
    const text = document.createTextNode('x')
    const work = measure(() => {
        parent.appendChild(marker)
        parent.appendChild(element)
        parent.appendChild(text)
    })
    expect(work).toMatchObject({
        elementsMoved: 1,
        markersMoved: 1,
        textMoved: 1,
    })
    expect(work).not.toHaveProperty('nodesMoved')
})

// Reverted to a single always-live record, case 2 inherits case 1's totals.
test('counts land in the discard between cases', () => {
    const parent = document.createElement('div')
    const first = measure(() => parent.appendChild(document.createElement('b')))
    parent.appendChild(document.createElement('i')) // outside a case body
    const second = measure(() =>
        parent.appendChild(document.createElement('u')),
    )
    expect(first.elementsMoved).toBe(1)
    expect(second.elementsMoved).toBe(1)
    expect(second.nodesCreated).toBe(1)
})

// THE RULE THE LIST CANNOT SUPPLY. Reverted — let it through — a reconcile written
// with `node.normalize()` reports `elementsMoved: 0`, every RENDERER gate goes green,
// and the lane has landed the failure it exists to issue.
test('an uncounted mutator throws rather than reporting 0', () => {
    const parent = document.createElement('div')
    parent.appendChild(document.createTextNode('a'))
    parent.appendChild(document.createTextNode('b'))
    expect(() => measure(() => parent.normalize())).toThrow(
        /harness\/measure does not count/,
    )
    // And it is inert outside a case body, or every suite in the repo would fail on
    // a mutation nobody was measuring.
    expect(() => parent.normalize()).not.toThrow()
})

// COUNT THE OUTERMOST PATCHED CALL ONLY, and this is the case that decides whether
// the both-substrates claim survives. happy-dom implements `textContent` in
// JavaScript over `removeChild`; Chromium implements it in C++ where no JS-visible
// call happens. Measured: `textContent = ''` on a node with two children reports 2
// `removeChild` calls under happy-dom and 0 under Chromium. Reverted — drop the
// re-entrancy guard — this reads 4 under bun and 2 under chromium, with the
// byte-identical patch-set gate still passing.
test('a textContent write counts its own removals once', () => {
    const parent = document.createElement('div')
    parent.appendChild(document.createElement('b'))
    parent.appendChild(document.createElement('i'))
    const work = measure(() => {
        parent.textContent = ''
    })
    expect(work.elementsMoved).toBe(2)
    expect(work.nodesCreated).toBe(0)
})

test('a textContent write with a value creates exactly one text node', () => {
    const parent = document.createElement('div')
    parent.appendChild(document.createElement('b'))
    const work = measure(() => {
        parent.textContent = 'hello'
    })
    expect(work).toMatchObject({
        elementsMoved: 1,
        textMoved: 1,
        nodesCreated: 1,
    })
})

// `RENDERER.md`'s compiled arm makes every instance and every row by clone, so a
// patch set without `cloneNode` reports `nodesCreated: 0` for the whole arm while the
// vanilla arm reports 3 per row — the ratio upside down.
test('cloneNode is counted, or the compiled arm reports creating nothing', () => {
    const template = document.createElement('template')
    template.innerHTML = '<li><span></span></li>'
    const work = measure(() => {
        for (let index = 0; index < 5; index += 1)
            template.content.firstChild?.cloneNode(true)
    })
    expect(work.nodesCreated).toBe(5)
})

// A redundant write is the row `RENDERER.md` orders and it cannot be read off the
// total. Reverted to one `dataWrites` field, an implementation that writes the same
// string per row and one that skips it report the same number.
test('a .data write that changes nothing is counted apart', () => {
    const text = document.createTextNode('7')
    const work = measure(() => {
        text.data = '7'
        text.data = '8'
    })
    expect(work).toMatchObject({ dataWrites: 2, redundantDataWrites: 1 })
})

// A CLASS WRITE AND A STYLE WRITE ARE DIFFERENT COSTS and are different rows: a class
// goes through the cascade and its cost depends on whether a rule matches it, where an
// inline style skips the cascade entirely. Both were REFUSED until a hand-written arm
// whose subject is class and style needed counting rather than a throw.
//
// Reverted — count a style write in the `styleWrites` row without taking the depth in
// the proxy's set trap — `style.paddingLeft = x` reports 2 under happy-dom, which
// implements a property write over its own patched `setProperty`, and 1 in chromium
// where the property is native. The textContent divergence, one layer down.
test('class writes and style writes are counted, and apart', () => {
    const element = document.createElement('div')
    const work = measure(() => {
        element.classList.add('hot')
        element.classList.toggle('cold')
        element.style.paddingLeft = '4px'
        element.style.setProperty('color', 'red')
    })
    expect(work).toMatchObject({
        classWrites: 2,
        styleWrites: 2,
        attributesSet: 0,
    })
})

// The proxy is per armed case, so `el.style` keeps one identity inside a case body and
// hands back the real declaration outside one — an instrument that changed an object's
// identity for the process would be a change to the thing it measures.
test('the style proxy is scoped to the case and writes still land', () => {
    const element = document.createElement('div')
    measure(() => {
        expect(element.style).toBe(element.style)
        element.style.paddingLeft = '4px'
    })
    expect(element.style.constructor.name).toBe('CSSStyleDeclaration')
    expect(element.style.paddingLeft).toBe('4px')
})

// `addEventListener` is NOT "bindings per row". A keyed row calls it in neither arm,
// so read as the binding count the two arms agree at zero with the mechanism in and
// out — a gate green against its own bug. A listener is a DOM call this lane counts;
// a binding run is something only the subject can count, and publishes.
test('listeners bound are counted and nothing published is invented', () => {
    const standing = publish(undefined)
    try {
        const element = document.createElement('button')
        const work = measure(() => element.addEventListener('click', () => {}))
        expect(work.listenersBound).toBe(1)
        expect(work.published).toEqual({})
    } finally {
        publish(standing)
    }
})

// A SUBJECT'S OWN COUNTERS are read off the record it publishes, zeroed per case, and
// NOT off a DOM patch — a prototype patch cannot see an effect rerun, and this lane may
// not import the subject to count one.
//
// The one gate in this file whose broken arm is INSTALLABLE, so it carries a runnable
// revert rather than a comment: the mechanism lives behind a global, and a global is
// something a test can replace. The rest of the reverts here are structural — a
// module-level depth guard, a record shape fixed at construction — and are recorded
// above with the number each reports.
/** Replaces the published records, returning what stood before so a test can put it back. */
function publish(
    records: PublishedWork | undefined,
): PublishedWork | undefined {
    const global = globalThis as Record<string, unknown>
    const standing = global[PUBLISHED_WORK_KEY] as PublishedWork | undefined
    if (records === undefined) delete global[PUBLISHED_WORK_KEY]
    else global[PUBLISHED_WORK_KEY] = records
    return standing
}

gate(
    'a published counter is read off its record and zeroed per case',
    {
        // A record that refuses to be zeroed: case 2 then inherits case 1's wakes,
        // which is the same defect as a single always-live DOM record one level up.
        revert: () => {
            let wakes = 0
            const standing = publish({
                subject: {
                    get wakes() {
                        return wakes
                    },
                    set wakes(next: number) {
                        if (next !== 0) wakes = next
                    },
                },
            })
            return () => publish(standing)
        },
        worth: { wakes: 3 },
    },
    () => {
        const global = globalThis as Record<string, unknown>
        global[PUBLISHED_WORK_KEY] ??= {}
        const records = global[PUBLISHED_WORK_KEY] as PublishedWork
        const seeded = records.subject === undefined
        if (seeded) records.subject = { wakes: 0 }
        try {
            const first = measure(() => {
                ;(records.subject as { wakes: number }).wakes += 3
            })
            expect(publishedBy(first, 'subject', ['wakes'])?.wakes).toBe(3)
            const second = measure(() => {})
            expect(publishedBy(second, 'subject', ['wakes'])?.wakes).toBe(0)
        } finally {
            if (seeded) delete records.subject
        }
    },
)

// A SOURCE NOBODY PUBLISHED IS ABSENT, NOT ZERO. `0` would be the row saying "the op
// woke nobody" about a counter that had never been wired — 43.19.
//
// The revert is STRUCTURAL — the record starts empty in `blankWork()` — so it is a
// comment with its number, verified by hand: seed it with a zeroed source and
// `publishedBy` reports `{ wakes: 0 }` where this asks for null, which is the reading
// every work gate downstream would have accepted.
test('a source that published nothing reads as absent, not as zero', () => {
    const standing = publish(undefined)
    try {
        const work = measure(() => document.createElement('div'))
        expect(work.nodesCreated).toBe(1)
        expect(publishedBy(work, 'subject', ['wakes'])).toBeNull()
    } finally {
        publish(standing)
    }
})

// A RECORD MISSING A FIELD IS NAMED, NOT FILLED. Zeroing only touches a field that is
// there and is a number, so a field the publisher never declared stays missing rather
// than being CREATED at 0 and read back at 0 — and `publishedBy` names it.
//
// Structural revert, verified by running it: zero every field the reader names and a
// record carrying only `wakes` reports `descents: 0`, and a k=8 gate of 16 nodes
// visited against 256 passes on that 0. Nothing anywhere says a word.
test('a published record missing a field throws naming it', () => {
    const standing = publish({ subject: { wakes: 0 } })
    try {
        const work = measure(() => {})
        expect(work.published.subject).toEqual({ wakes: 0 })
        expect(() =>
            publishedBy(work, 'subject', ['wakes', 'descents']),
        ).toThrow(/numeric descents/)
        publish({ subject: { wakes: 0, runs: 'many' } as never })
        const unread = measure(() => {})
        expect(() => publishedBy(unread, 'subject', ['runs'])).toThrow(
            /numeric runs/,
        )
    } finally {
        publish(standing)
    }
})

// Reverted — return the duration — a patched-DOM millisecond gets quoted as a result.
// The interlock replaced the overhead measurement rather than deferring it.
test('time() throws while the counters are armed', () => {
    expect(() =>
        measure(() => {
            time({ case: 'nested', arms: { one: () => {} } })
        }),
    ).toThrow(/mutually exclusive passes/)
})

// And outside a case body it still refuses, one refusal further down: an emulated DOM
// cannot produce a millisecond anybody should quote.
test('time() under bun refuses on the emulated DOM', () => {
    expect(() => time({ case: 'emulated', arms: { one: () => {} } })).toThrow(
        /happy-dom can produce a count|parallel worker/,
    )
})

// THE BOTH-SUBSTRATES GATE'S BUN HALF. Asserted on the LIST rather than on a count,
// because a count is what goes quietly to zero — a member the substrate does not
// have would otherwise be skipped in silence. The chromium half compares this exact
// list against the one the injectable reports.
test('the patch set is the declared list, by interface and member', () => {
    const installed = patchSet()
    expect(installed.length).toBeGreaterThan(50)
    expect(new Set(installed).size).toBe(installed.length)
    for (const required of [
        'Node.textContent',
        'Element.textContent',
        'CharacterData.textContent',
        'Node.cloneNode',
        'CharacterData.data',
        'Document.createComment',
        'EventTarget.addEventListener',
        'DOMTokenList.add',
        'CSSStyleDeclaration.setProperty',
        'Element.moveBefore',
    ])
        expect(installed).toContain(required)
})

// AN `html` WRITE IS COUNTED FROM WHAT IT ADDED, not from what the container holds.
// Reverted — walk the receiver's whole parent as created — a one-element
// `insertAdjacentHTML` beside five siblings reports `nodesCreated: 7` and
// `elementsMoved: 6`, and every ratio the row appears in is upside down.
test('insertAdjacentHTML counts only the nodes it created', () => {
    const parent = document.createElement('div')
    for (let index = 0; index < 5; index += 1)
        parent.appendChild(document.createElement('p'))
    const anchor = parent.firstChild as Element
    const work = measure(() => {
        anchor.insertAdjacentHTML('beforebegin', '<b>x</b>')
    })
    // The `<b>` and its text, and only the `<b>` was inserted.
    expect(work).toMatchObject({ nodesCreated: 2, elementsMoved: 1 })
})

// Reverted — return before the after-tally because the receiver is detached — an
// `outerHTML` write reports 0 for every field, which is exactly the silent zero the
// `refused` list exists to prevent. The replacement is reachable through the parent
// captured before the call.
test('outerHTML counts the replacement rather than reporting nothing', () => {
    const parent = document.createElement('div')
    const child = document.createElement('span')
    parent.appendChild(child)
    const work = measure(() => {
        child.outerHTML = '<i><em>a</em></i>'
    })
    // `<i>`, `<em>` and the text: three created, and the span out and the `<i>` in.
    expect(work).toMatchObject({ nodesCreated: 3, elementsMoved: 2 })
})

// A `<template>` writes into its `content` fragment rather than into its own
// children, and the compiled arm makes every row from one — reverted to the element,
// the fragment is invisible and the whole arm reports creating nothing.
test('a template innerHTML counts into the content fragment', () => {
    const template = document.createElement('template')
    const work = measure(() => {
        template.innerHTML = '<li><span></span></li>'
    })
    expect(work.nodesCreated).toBe(2)
})
