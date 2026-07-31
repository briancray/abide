// ATTACH-HYDRATION — CLAIM SCAFFOLDING (Stage 2, PR3).
//
// Drives the emitted `hydrate($container, $scope)` DIRECTLY (not via bootstrap/navigate, which are
// wired in PR7). For leaf / element / attr fixtures it: (1) renders the anchored server HTML into a
// happy-dom host, (2) captures references to the specific server nodes, (3) hydrates, (4) asserts the
// CLAIMED node IS the SAME Node object (`claimed === captured` — the load-bearing no-recreate check),
// (5) asserts NO write happened on hydration pass 1 (decision 9 — trust server output), (6) asserts a
// subsequent state update DOES mutate the SAME node in place. Includes the text-merge split case
// (`Hi {name}!`) and the empty-value lazy-create case. Blocks are PR4 — not exercised here.

import { describe, expect, spyOn, test } from 'bun:test'
import { state } from '../../shared/internal/reactive.ts'
import { memo } from '../../shared/memo.ts'
import { loadEmitted } from './emit.ts'

function tick(): Promise<void> {
    return Promise.resolve()
}

function must<T>(value: T | null | undefined, message = 'expected a non-null value'): T {
    if (value === null || value === undefined) throw new Error(message)
    return value
}

// The hydration-mismatch diagnostic now rides the gated `abide:hydrate` log channel instead of a bare
// `console.warn`. Under the window-deleted test preload `isBrowser` is false, so it takes the server
// path (stderr, TSV). Enable the channel and tap stderr to capture the `[abide:hydrate]` lines emitted
// while `run` executes.
function captureHydrateWarnings(run: () => void): string[] {
    const previousDebug = Bun.env.DEBUG
    Bun.env.DEBUG = 'abide:hydrate'
    const lines: string[] = []
    const originalWrite = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
        lines.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
        return true
    }) as typeof process.stderr.write
    try {
        run()
    } finally {
        process.stderr.write = originalWrite
        if (previousDebug === undefined) delete Bun.env.DEBUG
        else Bun.env.DEBUG = previousDebug
    }
    return lines.filter((line) => line.includes('[abide:hydrate]'))
}

const TEXT = 3
const COMMENT = 8

// A scope whose state-backed entries read their CURRENT value through a getter (so both the server
// render and the client hydrate read the same live memo), plus any plain values passed through.
function makeScope(
    states: Record<string, ReturnType<typeof state>>,
    plain: Record<string, unknown> = {},
): Record<string, unknown> {
    const scope: Record<string, unknown> = { ...plain }
    for (const [name, st] of Object.entries(states)) {
        Object.defineProperty(scope, name, { get: () => st(), enumerable: true })
    }
    return scope
}

describe('interpolation leaf — claim + suppress-write + in-place update', () => {
    test('claims the SAME server text node (no static prefix) and never recreates it', async () => {
        const name = state('Bob')
        const scope = makeScope({ name })
        const emitted = await loadEmitted('<span>{name}</span>')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const span = must(host.querySelector('span'))
        const serverTextNode = span.firstChild as Text // "Bob"
        expect(serverTextNode.nodeType).toBe(TEXT)
        expect(serverTextNode.data).toBe('Bob')

        const dispose = emitted.hydrate(host, scope)

        // (4) SAME Node object claimed — not recreated.
        expect(must(host.querySelector('span')).firstChild).toBe(serverTextNode)
        // (5) no write on pass 1 — the server's "Bob" is trusted verbatim.
        expect(serverTextNode.data).toBe('Bob')

        // (6) a subsequent update mutates the SAME node in place.
        name.set('Alice')
        await tick()
        expect(serverTextNode.data).toBe('Alice')
        expect(must(host.querySelector('span')).firstChild).toBe(serverTextNode)

        dispose()
    })

    test('text-merge: prefixLen splits the merged node so the static prefix is NOT the dynamic node', async () => {
        const name = state('Bob')
        const scope = makeScope({ name })
        const emitted = await loadEmitted('Hi {name}!')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        // The parser merged the static prefix + dynamic value into ONE text node: "Hi Bob".
        const merged = host.firstChild as Text
        expect(merged.nodeType).toBe(TEXT)
        expect(merged.data).toBe('Hi Bob')

        emitted.hydrate(host, scope)

        // The merged node is split at prefixLen (3): the ORIGINAL node keeps identity as the static "Hi ",
        // and a fresh tail node holds the dynamic value — so the prefix can never be captured as dynamic.
        expect(merged.data).toBe('Hi ')
        const dynamic = merged.nextSibling as Text
        expect(dynamic.nodeType).toBe(TEXT)
        expect(dynamic.data).toBe('Bob') // no write on pass 1

        name.set('Alice')
        await tick()
        // Only the dynamic tail node mutates; the static prefix stays put.
        expect(dynamic.data).toBe('Alice')
        expect(merged.data).toBe('Hi ')
        expect(merged.nextSibling).toBe(dynamic) // same dynamic node, updated in place
    })

    test('empty value: server emitted no text node → lazy create on first write', async () => {
        const name = state('')
        const scope = makeScope({ name })
        const emitted = await loadEmitted('<span>{name}</span>')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const span = must(host.querySelector('span'))
        // Empty value → only the anchor comment, no text node.
        expect(span.childNodes.length).toBe(1)
        expect(must(span.firstChild).nodeType).toBe(COMMENT)

        emitted.hydrate(host, scope)

        // Pass 1 claims nothing and creates nothing (nothing to show).
        expect(span.childNodes.length).toBe(1)

        // First real write lazily creates the text node, positioned before the anchor.
        name.set('Hello')
        await tick()
        expect(span.childNodes.length).toBe(2)
        expect(must(span.firstChild).nodeType).toBe(TEXT)
        expect((span.firstChild as Text).data).toBe('Hello')
        expect(must(span.lastChild).nodeType).toBe(COMMENT)
    })
})

describe('adjacent leaves — the PR3 gap the stateful cursor closes (PR4)', () => {
    test('{a}{b}: two DISTINCT same server text nodes are claimed (no positional desync)', async () => {
        const a = state('A')
        const b = state('B')
        const scope = makeScope({ a, b })
        const emitted = await loadEmitted('{a}{b}')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        // Server: value + anchor per leaf → ["A", <!---->, "B", <!---->]. The clone skeleton has only
        // two <!----> anchors, so PR3's positional nav shifted here; the cursor tracks the real DOM.
        const textA = host.childNodes[0] as Text
        const textB = host.childNodes[2] as Text
        expect(textA.data).toBe('A')
        expect(textB.data).toBe('B')

        emitted.hydrate(host, scope)

        expect(host.childNodes[0]).toBe(textA) // same node, not recreated
        expect(host.childNodes[2]).toBe(textB)
        expect(textA.data).toBe('A') // no write on pass 1
        expect(textB.data).toBe('B')

        a.set('X')
        b.set('Y')
        await tick()
        expect(textA.data).toBe('X') // both mutate in place, no swap
        expect(textB.data).toBe('Y')
        expect(host.childNodes[0]).toBe(textA)
        expect(host.childNodes[2]).toBe(textB)
    })
})

describe('{#if} block — claim branch, suppress write, flip creates fresh (PR4)', () => {
    test("claims the rendered branch's SAME nodes; toggle off removes; toggle on re-creates", async () => {
        const show = state(true)
        const msg = state('hi')
        const scope = makeScope({ show, msg })
        const emitted = await loadEmitted('{#if show}<p>{msg}</p>{/if}')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverP = must(host.querySelector('p'))
        const serverText = serverP.firstChild as Text
        expect(serverText.data).toBe('hi')

        emitted.hydrate(host, scope)

        // (a) branch nodes are the SAME objects (claimed, not recreated).
        expect(host.querySelector('p')).toBe(serverP)
        // (b) no write on pass 1.
        expect(serverText.data).toBe('hi')

        // (c) a reactive change inside the claimed branch mutates the SAME node.
        msg.set('bye')
        await tick()
        expect(host.querySelector('p')).toBe(serverP)
        expect(serverText.data).toBe('bye')

        // Flip the condition off → the branch is torn down.
        show.set(false)
        await tick()
        expect(host.querySelector('p')).toBeNull()

        // Flip back on → a FRESH branch is created (expected: not the server node).
        show.set(true)
        await tick()
        const freshP = must(host.querySelector('p'))
        expect(freshP).not.toBeNull()
        expect(freshP).not.toBe(serverP)
        expect(freshP.textContent).toBe('bye')
    })
})

describe('{#switch} block — claim matched case, flip creates fresh (PR4)', () => {
    test('claims the SAME case nodes; flipping the discriminant swaps to fresh DOM', async () => {
        const color = state('red')
        const scope = makeScope({ color })
        const emitted = await loadEmitted(
            '{#switch color}{:case "red"}<p>R</p>{:case "blue"}<p>B</p>{/switch}',
        )

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverP = must(host.querySelector('p'))
        expect(serverP.textContent).toBe('R')

        emitted.hydrate(host, scope)

        expect(host.querySelector('p')).toBe(serverP) // claimed, same node
        expect(serverP.textContent).toBe('R')

        color.set('blue')
        await tick()
        const blueP = must(host.querySelector('p'))
        expect(blueP.textContent).toBe('B')
        expect(blueP).not.toBe(serverP) // a flip creates fresh DOM
    })
})

describe('{#try} block — claim the successful body (PR4)', () => {
    test('claims the SAME body nodes and wires reactivity', async () => {
        const msg = state('ok')
        const scope = makeScope({ msg })
        const emitted = await loadEmitted('{#try}<p>{msg}</p>{:catch e}<span>err</span>{/try}')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverP = must(host.querySelector('p'))
        const serverText = serverP.firstChild as Text
        expect(serverText.data).toBe('ok')

        emitted.hydrate(host, scope)

        expect(host.querySelector('p')).toBe(serverP) // claimed
        expect(serverText.data).toBe('ok') // no write on pass 1

        msg.set('still-ok')
        await tick()
        expect(host.querySelector('p')).toBe(serverP)
        expect(serverText.data).toBe('still-ok')
    })
})

// The RUNTIME convention, which is unchanged: a component function's 2nd argument is its children
// factory. Only the TEMPLATE spelling was retired — `<slot/>` is what lowers to this now.
describe('component children — claim the children region (PR4)', () => {
    // A pass-through component, isomorphic: on the server `children()` yields a Promise<Raw> (has
    // `.then`); on the client it yields a Mountable (has `.mount`). Both just render the children.
    function passThrough() {
        return (_props: Record<string, unknown>, children: (() => unknown) | null) => {
            const kids = children ? children() : null
            if (kids !== null && typeof (kids as { then?: unknown }).then === 'function')
                return kids // server
            if (kids !== null && typeof (kids as { mount?: unknown }).mount === 'function') {
                return {
                    mount: (t: Node, a: Node | null) =>
                        (kids as { mount: (t: Node, a: Node | null) => () => void }).mount(t, a),
                }
            }
            return ''
        }
    }

    test('the children slot claims the SAME server text node under a component', async () => {
        const x = state('Y')
        const scope = makeScope({ x }, { Wrap: passThrough() })
        const emitted = await loadEmitted('<Wrap>{x}</Wrap>')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        // Server children region: value + anchor inside the paired block anchors.
        const serverText = Array.from(host.childNodes).find(
            (n) => n.nodeType === TEXT && (n as Text).data === 'Y',
        ) as Text
        expect(serverText).toBeDefined()

        emitted.hydrate(host, scope)

        // Same text node claimed inside the component's children region.
        const claimed = Array.from(host.childNodes).find((n) => n.nodeType === TEXT) as Text
        expect(claimed).toBe(serverText)
        expect(serverText.data).toBe('Y') // no write on pass 1

        x.set('Z')
        await tick()
        expect(serverText.data).toBe('Z') // mutated in place
    })
})

describe('{#for} keyed sync block — claim items, then reconcile (PR4)', () => {
    test('claims each SAME <li>, then add / remove / reorder work normally', async () => {
        const items = state([1, 2])
        const scope = makeScope({ items })
        const emitted = await loadEmitted('{#for n of items by n}<li>{n}</li>{/for}')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverLis = Array.from(host.querySelectorAll('li'))
        expect(serverLis.map((li) => li.textContent)).toEqual(['1', '2'])

        emitted.hydrate(host, scope)

        // (a) initial items are the SAME <li> nodes — claimed, not recreated.
        const afterLis = Array.from(host.querySelectorAll('li'))
        expect(afterLis[0]).toBe(serverLis[0])
        expect(afterLis[1]).toBe(serverLis[1])
        expect(afterLis.map((li) => li.textContent)).toEqual(['1', '2'])

        // Add: a fresh <li> appears, survivors stay identical.
        items.set([1, 2, 3])
        await tick()
        const added = Array.from(host.querySelectorAll('li'))
        expect(added.length).toBe(3)
        expect(added[0]).toBe(serverLis[0])
        expect(added[1]).toBe(serverLis[1])
        expect(added.map((li) => li.textContent)).toEqual(['1', '2', '3'])

        // Remove: survivor identity preserved.
        items.set([2, 3])
        await tick()
        const removed = Array.from(host.querySelectorAll('li'))
        expect(removed.map((li) => li.textContent)).toEqual(['2', '3'])
        expect(removed[0]).toBe(serverLis[1]) // "2" is still the original server node

        // Reorder: keyed reuse moves the same nodes.
        const nodeFor2 = removed[0]
        const nodeFor3 = removed[1]
        items.set([3, 2])
        await tick()
        const reordered = Array.from(host.querySelectorAll('li'))
        expect(reordered.map((li) => li.textContent)).toEqual(['3', '2'])
        expect(reordered[0]).toBe(nodeFor3)
        expect(reordered[1]).toBe(nodeFor2)
    })
})

describe('nested — element descent + block claim in the same level (PR4)', () => {
    test('<div><p>{a}</p>{#if show}<span>{b}</span>{/if}</div> claims across the DFS cursor', async () => {
        const a = state('A')
        const b = state('B')
        const show = state(true)
        const scope = makeScope({ a, b, show })
        const emitted = await loadEmitted('<div><p>{a}</p>{#if show}<span>{b}</span>{/if}</div>')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverP = must(host.querySelector('p'))
        const serverSpan = must(host.querySelector('span'))
        expect((serverP.firstChild as Text).data).toBe('A')
        expect((serverSpan.firstChild as Text).data).toBe('B')

        emitted.hydrate(host, scope)

        // Both the descended element leaf AND the block leaf claim their SAME server nodes.
        expect(host.querySelector('p')).toBe(serverP)
        expect(host.querySelector('span')).toBe(serverSpan)
        expect((serverP.firstChild as Text).data).toBe('A')
        expect((serverSpan.firstChild as Text).data).toBe('B')

        a.set('A2')
        b.set('B2')
        await tick()
        expect((serverP.firstChild as Text).data).toBe('A2')
        expect((serverSpan.firstChild as Text).data).toBe('B2')
        expect(host.querySelector('span')).toBe(serverSpan)

        // The nested block still flips correctly after hydration.
        show.set(false)
        await tick()
        expect(host.querySelector('span')).toBeNull()
        expect(host.querySelector('p')).toBe(serverP) // sibling untouched
    })
})

describe('element — claim + listener attach', () => {
    test('claims the SAME element node, wires the listener, and does not clear content', async () => {
        const bid = state('b1')
        let clicks = 0
        const scope = makeScope({ bid }, { handler: () => clicks++ })
        const emitted = await loadEmitted('<button id={bid} onclick={handler}>Go</button>')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverButton = must(host.querySelector('button'))
        expect(serverButton.getAttribute('id')).toBe('b1')
        expect(serverButton.textContent).toBe('Go')

        emitted.hydrate(host, scope)

        // (4) SAME element object claimed — the region was moved out and back, never re-created.
        expect(host.querySelector('button')).toBe(serverButton)
        // Static content untouched (no textContent clear).
        expect(serverButton.textContent).toBe('Go')

        // Listener attached during the walk (decision 7).
        serverButton.dispatchEvent(new Event('click'))
        expect(clicks).toBe(1)
    })
})

describe('attribute — suppress-write then in-place update', () => {
    test('does NOT re-apply the attribute on pass 1, then applies to the SAME node on update', async () => {
        const value = state('v1')
        const scope = makeScope({ value })
        const emitted = await loadEmitted('<div id={value}></div>')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverDiv = must(host.querySelector('div'))
        expect(serverDiv.getAttribute('id')).toBe('v1')

        const setAttrSpy = spyOn(serverDiv, 'setAttribute')

        emitted.hydrate(host, scope)

        // (5) no attribute write on pass 1 — the server-serialized value is trusted (decision 9).
        expect(setAttrSpy).not.toHaveBeenCalled()
        expect(host.querySelector('div')).toBe(serverDiv) // SAME node claimed
        expect(serverDiv.getAttribute('id')).toBe('v1')

        // (6) update applies to the SAME node.
        value.set('v2')
        await tick()
        expect(setAttrSpy).toHaveBeenCalledTimes(1)
        expect(serverDiv.getAttribute('id')).toBe('v2')

        setAttrSpy.mockRestore()
    })

    test('class:toggle is suppressed on pass 1, then toggles the SAME node', async () => {
        const active = state(true)
        const scope = makeScope({ active })
        const emitted = await loadEmitted('<div class:on={active}></div>')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverDiv = must(host.querySelector('div'))
        expect(serverDiv.classList.contains('on')).toBe(true)

        emitted.hydrate(host, scope)
        expect(host.querySelector('div')).toBe(serverDiv)
        expect(serverDiv.classList.contains('on')).toBe(true) // unchanged on pass 1

        active.set(false)
        await tick()
        expect(serverDiv.classList.contains('on')).toBe(false) // toggled on same node
    })
})

describe('{#await} block — claim the settled branch (PR5)', () => {
    test('seed-primed RPC read: claims the SAME then-branch node, no write on pass 1', async () => {
        const getName = memo<{ id: number }, string>(async ({ id }) => `loaded-${id}`)
        getName.seed({ id: 1 }, 'Bob') // prime the slot so the read is synchronously settled
        const scope = { getName }
        const emitted = await loadEmitted(
            '{#await getName({ id: 1 })}<em>loading</em>{:then n}<p>{n}</p>{/await}',
        )

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverP = must(host.querySelector('p'))
        const serverText = serverP.firstChild as Text
        expect(serverText.data).toBe('Bob')
        expect(host.querySelector('em')).toBeNull() // server rendered the RESOLVED (then) branch, not pending

        emitted.hydrate(host, scope)

        // (4) SAME then-branch node claimed — not the pending branch, not recreated.
        expect(host.querySelector('p')).toBe(serverP)
        expect(host.querySelector('em')).toBeNull() // pending never mounted (decision 9)
        // (5) no write on pass 1 — the server-resolved "Bob" is trusted verbatim.
        expect(serverText.data).toBe('Bob')

        // (6) an invalidation-style update (publish) rebuilds the branch with the new value.
        getName.publish({ id: 1 }, 'Alice')
        await tick()
        await tick()
        expect(must(host.querySelector('p')).textContent).toBe('Alice')
    })

    test('synchronously-settled plain value: claims then-branch; a dep change rebuilds', async () => {
        const user = state('Bob')
        const scope = makeScope({ user })
        const emitted = await loadEmitted(
            '{#await user}<em>loading</em>{:then u}<p>{u}</p>{/await}',
        )

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverP = must(host.querySelector('p'))
        expect(serverP.textContent).toBe('Bob')

        emitted.hydrate(host, scope)

        expect(host.querySelector('p')).toBe(serverP) // claimed, same node
        expect(host.querySelector('em')).toBeNull()
        expect(serverP.textContent).toBe('Bob') // no write on pass 1

        // A change to the awaited dep re-runs the await → pending → then with the new value.
        user.set('Alice')
        await tick()
        await tick()
        expect(must(host.querySelector('p')).textContent).toBe('Alice')
    })

    test(':catch — a synchronous rejection claims the SAME catch-branch node', async () => {
        const scope = {
            bad: () => {
                throw new Error('boom')
            },
        }
        const emitted = await loadEmitted(
            '{#await bad()}<em>loading</em>{:then u}<p>{u}</p>{:catch e}<span>{e.message}</span>{/await}',
        )

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverSpan = must(host.querySelector('span'))
        const serverText = serverSpan.firstChild as Text
        expect(serverText.data).toBe('boom')
        expect(host.querySelector('p')).toBeNull()

        emitted.hydrate(host, scope)

        // The catch branch is claimed (server rendered catch for the sync throw), same node, no write.
        expect(host.querySelector('span')).toBe(serverSpan)
        expect(host.querySelector('p')).toBeNull()
        expect(host.querySelector('em')).toBeNull()
        expect(serverText.data).toBe('boom')
    })

    test(':finally — claims then + finally in document order (SAME nodes)', async () => {
        const user = state('Bob')
        const status = state('done')
        const scope = makeScope({ user, status })
        const emitted = await loadEmitted(
            '{#await user}<em>loading</em>{:then u}<p>{u}</p>{:finally}<b>{status}</b>{/await}',
        )

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverP = must(host.querySelector('p'))
        const serverB = must(host.querySelector('b'))
        expect(serverP.textContent).toBe('Bob')
        expect(serverB.textContent).toBe('done')

        emitted.hydrate(host, scope)

        // Both the resolved (then) branch and the finally branch are claimed in place, same nodes.
        expect(host.querySelector('p')).toBe(serverP)
        expect(host.querySelector('b')).toBe(serverB)
        expect(serverP.textContent).toBe('Bob') // no write on pass 1
        expect(serverB.textContent).toBe('done')

        // A finally-branch reactive read still updates the SAME node in place after hydration.
        status.set('ready')
        await tick()
        expect(host.querySelector('b')).toBe(serverB)
        expect(serverB.textContent).toBe('ready')
    })

    test('genuinely-pending promise at hydrate: graceful create-fallback (pending → resolves)', async () => {
        // A real (thenable) promise cannot be peeked synchronously — the one unavoidable case. The server
        // SSR-awaits it and renders `then`; the client cannot, so it discards the server region, shows
        // `pending`, then swaps to `then`. No crash, no corruption.
        const scope = { slow: Promise.resolve('hi') }
        const emitted = await loadEmitted(
            '{#await slow}<em>loading</em>{:then v}<p>{v}</p>{/await}',
        )

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        expect(must(host.querySelector('p')).textContent).toBe('hi') // server rendered the resolved branch

        emitted.hydrate(host, scope)

        // Create-fallback: the server-resolved <p> is discarded, pending is mounted fresh.
        expect(host.querySelector('p')).toBeNull()
        expect(must(host.querySelector('em')).textContent).toBe('loading')

        // The promise then resolves and the then-branch is mounted.
        await tick()
        await tick()
        expect(host.querySelector('em')).toBeNull()
        expect(must(host.querySelector('p')).textContent).toBe('hi')
    })
})

describe('localized mismatch recovery + dev-warnings + whole-page fallback (PR6)', () => {
    test('wrong tag inside a block: that subtree is recreated, the SIBLING keeps node identity, dev-warns', async () => {
        const a = state('A')
        const b = state('B')
        const show = state(true)
        let clicks = 0
        const scope = makeScope({ a, b, show }, { h: () => clicks++ })
        // <span> is a root-level sibling OUTSIDE the {#if}; the mismatched <button> lives INSIDE it.
        const emitted = await loadEmitted(
            '<span>{a}</span>{#if show}<button onclick={h}>{b}</button>{/if}',
        )

        const host = document.createElement('div')
        // Corrupt the server DOM: the template expects <button> inside the if, the server produced <div>.
        // (Simulates non-deterministic render / external mutation / browser normalization — decision 5.)
        host.innerHTML = (await emitted.render(scope))
            .replace('<button', '<div')
            .replace('</button>', '</div>')
        const serverSpan = must(host.querySelector('span'))
        const serverSpanText = serverSpan.firstChild as Text
        expect(serverSpanText.data).toBe('A')
        expect(host.querySelector('button')).toBeNull() // it's a <div> right now
        expect(host.querySelector('div')).not.toBeNull()

        let dispose!: () => void
        const warnings = captureHydrateWarnings(() => {
            dispose = emitted.hydrate(host, scope)
        })

        // Localized recovery: only the {#if} subtree was rebuilt.
        // (a) the mismatched region is now the CORRECT <button> with the right content.
        const button = must(host.querySelector('button'))
        expect(button).not.toBeNull()
        expect(button.textContent).toBe('B')
        expect(host.querySelector('div')).toBeNull() // the wrong <div> was discarded

        // (b) the SIBLING <span> kept its exact node identity — recovery was NOT whole-page.
        expect(host.querySelector('span')).toBe(serverSpan)
        expect(must(host.querySelector('span')).firstChild).toBe(serverSpanText)
        expect(serverSpanText.data).toBe('A') // untouched, not re-rendered

        // (c) a dev-warning fired for the mismatch.
        expect(warnings.length).toBe(1)
        expect(must(warnings[0])).toContain('hydration mismatch')

        // (d) the recreated subtree is fully live: listener attached, sibling reactivity intact.
        button.dispatchEvent(new Event('click'))
        expect(clicks).toBe(1)
        b.set('B2')
        a.set('A2')
        await tick()
        expect(must(host.querySelector('button')).textContent).toBe('B2')
        expect(serverSpanText.data).toBe('A2')
        expect(must(host.querySelector('span')).firstChild).toBe(serverSpanText) // sibling STILL the same node

        dispose()
    })

    test('root-level unrecoverable mismatch: whole-page fresh mount, no throw, correct DOM', async () => {
        const b = state('B')
        let clicks = 0
        const scope = makeScope({ b }, { h: () => clicks++ })
        // A root-level dynamic element with no enclosing block — a tag mismatch escapes to the root.
        const emitted = await loadEmitted('<button onclick={h}>{b}</button>')

        const host = document.createElement('div')
        host.innerHTML = (await emitted.render(scope))
            .replace('<button', '<div')
            .replace('</button>', '</div>')
        expect(host.querySelector('button')).toBeNull()

        // Must NOT throw to the caller (decision 5 — hydration never corrupts / never throws).
        let dispose!: () => void
        let warnings: string[] = []
        expect(() => {
            warnings = captureHydrateWarnings(() => {
                dispose = emitted.hydrate(host, scope)
            })
        }).not.toThrow()

        // Whole-page fallback rebuilt the correct DOM from scratch.
        const button = must(host.querySelector('button'))
        expect(button).not.toBeNull()
        expect(button.textContent).toBe('B')
        expect(host.querySelector('div')).toBeNull()

        // Warned about the page root specifically.
        expect(warnings.length).toBeGreaterThan(0)
        expect(must(warnings[warnings.length - 1])).toContain('page root')

        // Fresh mount is fully interactive.
        button.dispatchEvent(new Event('click'))
        expect(clicks).toBe(1)
        b.set('B2')
        await tick()
        expect(must(host.querySelector('button')).textContent).toBe('B2')

        dispose()
    })

    test('happy path: matching server DOM claims same-node with NO warning and no recreation', async () => {
        const b = state('B')
        let clicks = 0
        const scope = makeScope({ b }, { h: () => clicks++ })
        const emitted = await loadEmitted('<button onclick={h}>{b}</button>')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope) // NO corruption — server matches the template
        const serverButton = must(host.querySelector('button'))

        let dispose!: () => void
        const warnings = captureHydrateWarnings(() => {
            dispose = emitted.hydrate(host, scope)
        })

        // The tag check passes → the SAME element is claimed (not recreated) and NO warning fires.
        expect(host.querySelector('button')).toBe(serverButton)
        expect(warnings.length).toBe(0)
        expect(serverButton.textContent).toBe('B') // no write on pass 1

        serverButton.dispatchEvent(new Event('click'))
        expect(clicks).toBe(1)

        dispose()
    })

    test("missing block anchor: the block's own region can't be located → bubbles to whole-page fallback", async () => {
        const show = state(true)
        const b = state('B')
        const scope = makeScope({ show, b })
        const emitted = await loadEmitted('{#if show}<button>{b}</button>{/if}')

        const host = document.createElement('div')
        // Strip the block OPEN anchor `<!--[-->` so the if block cannot find/bound its server region.
        host.innerHTML = (await emitted.render(scope)).replace('<!--[-->', '')
        expect(host.querySelector('button')).not.toBeNull()

        let dispose!: () => void
        let warnings: string[] = []
        expect(() => {
            warnings = captureHydrateWarnings(() => {
                dispose = emitted.hydrate(host, scope)
            })
        }).not.toThrow()

        // Recovered (whole-page here, since the missing open bubbles past the block) → correct DOM with
        // NO duplication (the mis-bounded partial-clear footgun is avoided by verifying the open anchor).
        expect(host.querySelectorAll('button').length).toBe(1)
        expect(must(host.querySelector('button')).textContent).toBe('B')
        expect(warnings.length).toBeGreaterThan(0)

        dispose()
    })
})

describe('{#for await} block — documented create-fallback (PR5)', () => {
    test('discards the SSR-drained items and re-creates from the iterator (no corruption)', async () => {
        // The client gets a fresh async iterator and must re-iterate from the start, so a same-node claim
        // of the drained prefix would duplicate. The block create-falls-back: clear + re-append.
        const scope = {
            rows: async function* () {
                yield 1
                yield 2
            },
        }
        const emitted = await loadEmitted('{#for await n of rows()}<li>{n}</li>{/for}')

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverLis = Array.from(host.querySelectorAll('li'))
        expect(serverLis.map((li) => li.textContent)).toEqual(['1', '2'])

        emitted.hydrate(host, scope)

        // The async iterator yields on microtasks; drain a few ticks, then assert the final DOM is
        // correct (exactly the re-created items, no duplication, no crash).
        for (let i = 0; i < 6; i++) await tick()
        const afterLis = Array.from(host.querySelectorAll('li'))
        expect(afterLis.map((li) => li.textContent)).toEqual(['1', '2'])
    })
})

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('{#await} claim swap tears down a FULLY-STATIC branch (regression: duplicate {:finally})', () => {
    // A seed-primed `{#await}` CLAIMS its resolved branch + finally on hydrate. A later reactive change
    // (the awaited value becomes a new pending promise) must remove the WHOLE claimed region before the
    // pending→settle rebuild. A fully-static `{:finally}` branch claims zero cursor-bounded roots, so its
    // teardown was a no-op — the old finally leaked next to the freshly-mounted one.
    test('swapping the awaited promise removes the prior then + finally (no duplicates)', async () => {
        // Non-thenable initial value → the claim path (mirrors a seed-primed RPC read).
        const job = state<unknown>('ready')
        const scope: Record<string, unknown> = {}
        Object.defineProperty(scope, 'job', { get: () => job(), enumerable: true })
        const src =
            '<p>{#await job}<span data-t="p">working</span>' +
            '{:then value}<span data-t="d">done: {value}</span>' +
            '{:finally}<span data-t="f">settled</span>{/await}</p>'
        const emitted = await loadEmitted(src)
        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        emitted.hydrate(host, scope)
        await wait(5)
        const count = (t: string): number => host.querySelectorAll(`[data-t="${t}"]`).length
        expect(count('f')).toBe(1)
        expect(count('d')).toBe(1)

        // Swap to a pending promise → pending shows, prior branch fully torn down.
        job.set(new Promise((resolve) => setTimeout(() => resolve('later'), 20)))
        await wait(5)
        expect(count('f')).toBe(0)
        expect(count('p')).toBe(1)

        // Settle → exactly one then + one finally, never two.
        await wait(40)
        expect(count('f')).toBe(1)
        expect(count('d')).toBe(1)
        expect(must(host.querySelector('[data-t="d"]')).textContent).toBe('done: later')
    })
})

describe('{#try} rolls back a body that throws MID-MOUNT (regression: leaked partial body)', () => {
    // When a body expression throws while the body is still mounting, the body never returns its
    // disposer — so the already-inserted DOM was untracked and leaked next to the `:catch` branch.
    test('a throwing body leaves no DOM behind when :catch takes over', async () => {
        const emitted = await loadEmitted(
            '{#try}<p data-t="body">value: {risky()}</p>{:catch e}<p data-t="caught">{e.message}</p>{/try}',
        )
        const host = document.createElement('div')
        emitted.mount(host, {
            risky: () => {
                throw new Error('boom')
            },
        })
        await tick()
        expect(host.querySelectorAll('[data-t="body"]').length).toBe(0)
        expect(host.querySelectorAll('[data-t="caught"]').length).toBe(1)
        expect(must(host.querySelector('[data-t="caught"]')).textContent).toBe('boom')
    })
})

describe('keyed {#for} of a nested block claims the whole item (regression: cursor desync)', () => {
    // A for-item whose body is a nested block (`{#try}`/`{#await}`) had the block's wiring RESEEK the
    // module cursor mid-item, so the for-block dropped its per-item end marker inside the item and
    // scrambled the DOM — a later re-key then left the stale item behind. The mount fn now restores the
    // post-walk cursor after wiring, so the item's extent (and teardown) is exact.
    test('re-keying the list disposes the prior nested-block item (exactly one body)', async () => {
        const run = state<{ id: number }>({ id: 0 })
        const scope: Record<string, unknown> = {}
        Object.defineProperty(scope, 'run', { get: () => run(), enumerable: true })
        const src =
            '{#for r of [run] by r.id}' +
            '{#try}<p data-t="body">id: {r.id}</p>{:finally}<p data-t="fin">fin</p>{/try}' +
            '{/for}'
        const emitted = await loadEmitted(src)
        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        emitted.hydrate(host, scope)
        await tick()
        expect(host.querySelectorAll('[data-t="body"]').length).toBe(1)
        expect(host.querySelectorAll('[data-t="fin"]').length).toBe(1)
        expect(must(host.querySelector('[data-t="body"]')).textContent).toBe('id: 0')

        // Re-key → old item disposed, new item mounted: still exactly one of each.
        run.set({ id: 1 })
        await tick()
        expect(host.querySelectorAll('[data-t="body"]').length).toBe(1)
        expect(host.querySelectorAll('[data-t="fin"]').length).toBe(1)
        expect(must(host.querySelector('[data-t="body"]')).textContent).toBe('id: 1')
    })
})

describe('interpolation corrects a client-only divergence on the hydrate primed pass (bind:element)', () => {
    // Decision-9 suppresses the FIRST reactive write to trust server output. But a `bind:element` node
    // ref is set during mount (a real client-only change) BEFORE the consuming interpolation's first
    // pass runs, so the server value ("none") diverges. The primed pass now corrects the claimed node
    // against the computed value when they differ.
    test('a bind:element node ref updates the dependent interpolation after hydrate', async () => {
        const node = state<unknown>(null)
        const refNode = (el: unknown): (() => void) => {
            node.set(el)
            return () => node.set(null)
        }
        const scope: Record<string, unknown> = { refNode }
        Object.defineProperty(scope, 'node', { get: () => node(), enumerable: true })
        const src = '<input bind:element={refNode} /><span>{node ? node.tagName : "none"}</span>'
        const emitted = await loadEmitted(src)
        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        expect(must(host.querySelector('span')).textContent).toBe('none') // server can't compute a client node ref
        emitted.hydrate(host, scope)
        await tick()
        expect(must(host.querySelector('span')).textContent).toBe('INPUT')
    })
})

describe('scoped <style> scope attribute survives SSR → hydrate (#13/#20)', () => {
    // The server emitter must stamp the #13 scope attribute on the element (matching the client
    // skeleton). Regression guard for #20: before the fix the server render omitted it, so the claimed
    // node kept no `data-ab-*` and the rewritten selector `.a[data-ab-<hash>]` matched nothing.
    test('the element the server rendered keeps its data-ab-<hash> attr after hydrate', async () => {
        const src = '<div class="a">x</div><style>.a{color:red}</style>'
        const emitted = await loadEmitted(src)
        const host = document.createElement('div')
        host.innerHTML = await emitted.render({})
        const div = must(host.querySelector('div'))
        // Server output carries the scope attr (matching the selector the <style> was rewritten to).
        const scopeAttr = must(div.getAttributeNames().find((n) => n.startsWith('data-ab-')))
        expect(scopeAttr).toBeDefined()
        expect(must(host.querySelector('style')).textContent).toContain(`.a[${scopeAttr}]`)

        emitted.hydrate(host, {})
        // Same node claimed (not recreated) AND it still carries the scope attr → styles apply.
        expect(host.querySelector('div')).toBe(div)
        expect(div.hasAttribute(scopeAttr)).toBe(true)
    })
})

describe('a component in an interpolation is REJECTED — components are invoked as tags', () => {
    // `{Name(…)}` used to be a second, legal way to render a component: an ordinary interpolation whose
    // value was a Mountable, which the server bracketed with `<!--[-->…<!--]-->` at RENDER time (by
    // Raw-ness) and the hydrate walk rediscovered by peeking. That made a leaf position two shapes instead
    // of one. The form is gone — `<Name/>` is the only invocation — so a leaf is always a single scalar.
    test('calling an inline component def in an interpolation is a compile error naming the tag fix', async () => {
        const src =
            '{#component Badge({ label })}<span class="badge">{label}</span>{/component}' +
            '<div>{Badge({ label: "Live" })}</div>'
        expect(loadEmitted(src)).rejects.toThrow('<Badge …/>')
    })

    test('a nested (render-prop) component def is rejected in the caller too', async () => {
        const src = '<Framed>{#component Header()}<h4>hi</h4>{/component}{Header()}</Framed>'
        expect(loadEmitted(src)).rejects.toThrow('<Header …/>')
    })

    test('a same-prefixed identifier and a member call are NOT false positives', async () => {
        // `Badges(…)` shares Badge's prefix and `fmt.Badge(…)` is a member call — neither is the component.
        const src =
            '{#component Badge({ label })}<span>{label}</span>{/component}' +
            '<div>{Badges()}{fmt.Badge()}</div>'
        const emitted = await loadEmitted(src)
        const scope = { Badges: () => 'a', fmt: { Badge: () => 'b' } }
        expect(await emitted.render(scope)).toBe('<div>a<!---->b<!----></div>')
    })

    test('a component arriving through PROPS and called is a loud runtime error on the server', async () => {
        // The static guard cannot see this one: inside `Framed`, `Render` is a destructured prop, not a
        // known component name. `serverRuntime.renderLeaf` catches it rather than splicing an unanchored
        // subtree that would desync every following sibling on hydrate.
        const src =
            '{#component Loud({ text })}<b>{text}</b>{/component}' +
            '{#component Framed({ Render })}<div>{Render({ text: "x" })}</div>{/component}' +
            '<Framed Render={Loud}/>'
        const emitted = await loadEmitted(src)
        expect(emitted.render({})).rejects.toThrow(/invoke a component as a tag/)
    })

    test('the same props-borne component call is loud on a client mount too', async () => {
        const src =
            '{#component Loud({ text })}<b>{text}</b>{/component}' +
            '{#component Framed({ Render })}<div>{Render({ text: "x" })}</div>{/component}' +
            '<Framed Render={Loud}/>'
        const emitted = await loadEmitted(src)
        const host = document.createElement('div')
        expect(() => emitted.mount(host, {})).toThrow(/invoke a component as a tag/)
    })
})

describe('{html(...)} region — extent READ from the server anchors, never re-derived', () => {
    // The claim used to (a) scan forward for the first empty comment to find its end anchor and (b) re-parse
    // the markup in a probe `<div>` to count how many nodes to walk back. Both are unsound for arbitrary raw
    // markup. The server now BRACKETS the region with a collision-checked `<!--[h-->…<!--]h-->` pair
    // (`serverRuntime.renderHtml`) and the claim reads the extent off those anchors.

    test('markup containing an empty comment does not truncate the region (the old scan stopped there)', async () => {
        const markup = state('<b>a</b><!----><i>b</i>')
        const scope = makeScope({ markup })
        const emitted = await loadEmitted(
            '<div>{html(markup)}<span data-testid="sib">S</span></div>',
        )
        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverSib = must(host.querySelector('[data-testid=sib]'))

        const captured = captureHydrateWarnings(() => emitted.hydrate(host, scope))
        expect(captured.length).toBe(0)
        // The sibling AFTER the region is the same node — the cursor did not land mid-region.
        expect(host.querySelector('[data-testid=sib]')).toBe(serverSib)

        markup.set('<em>c</em>')
        await tick()
        const div = must(host.querySelector('div'))
        // The whole old region was replaced — no stranded `<b>a</b>` / `<i>b</i>`.
        expect(div.querySelector('b')).toBe(null)
        expect(div.querySelector('i')).toBe(null)
        expect(must(div.querySelector('em')).textContent).toBe('c')
        expect(host.querySelector('[data-testid=sib]')).toBe(serverSib)
    })

    test('markup containing the close marker escalates the token, and the region still claims', async () => {
        const markup = state('<b>x</b><!--]h--><i>y</i>')
        const scope = makeScope({ markup })
        const emitted = await loadEmitted(
            '<div>{html(markup)}<span data-testid="sib">S</span></div>',
        )
        const host = document.createElement('div')
        const rendered = await emitted.render(scope)
        // The default `]h` occurs in the content, so the server committed to `[h0`/`]h0` instead.
        expect(rendered).toContain('<!--[h0-->')
        expect(rendered).toContain('<!--]h0-->')

        host.innerHTML = rendered
        const serverSib = must(host.querySelector('[data-testid=sib]'))
        const captured = captureHydrateWarnings(() => emitted.hydrate(host, scope))
        expect(captured.length).toBe(0)
        expect(host.querySelector('[data-testid=sib]')).toBe(serverSib)

        markup.set('<em>z</em>')
        await tick()
        const div = must(host.querySelector('div'))
        expect(div.querySelector('b')).toBe(null)
        expect(must(div.querySelector('em')).textContent).toBe('z')
        expect(host.querySelector('[data-testid=sib]')).toBe(serverSib)
    })

    test('a static prefix is not swallowed when the markup is text (the parser merged them)', async () => {
        // Old shape: `A` + `tail` + `<!---->` parsed as ONE text node "Atail"; the probe counted 1 node for
        // "tail", so the backward walk claimed the merged node — and the first update removed the "A" with it.
        const tail = state('tail')
        const scope = makeScope({ tail })
        const emitted = await loadEmitted('<div>A{html(tail)}</div>')
        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const div = must(host.querySelector('div'))
        expect(div.textContent).toBe('Atail')

        emitted.hydrate(host, scope)
        expect(div.textContent).toBe('Atail')

        tail.set('other')
        await tick()
        expect(div.textContent).toBe('Aother')
    })
})
