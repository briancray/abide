// `ArmRegion`, driven directly: the transition an `{#if}`, a chosen component and a `{#try}` share,
// apart from the compiler that emits the one call to it. Every arm counts its builds and mounts and
// every mount answers a scope that counts its stops, so a swap that did MORE work than it should —
// rebuilt a hydrated arm, mounted twice, left the old arm's bindings running — fails here while the
// region's nodes would still read right.

import { expect, test } from 'bun:test'
import { ArmRegion, ChosenRegion } from '#ui/ArmRegion.ts'
import type { Region } from '#ui/regions.ts'
import { Scope } from '#ui/Scope.ts'

type Counted = {
    builds: number
    mounts: number
    stops: number
    arm: () => {
        build: (document: Document) => Node[]
        mount: (root: Region) => Scope
    }
}

function counted(tag: string): Counted {
    const counts: Counted = {
        builds: 0,
        mounts: 0,
        stops: 0,
        arm: () => ({
            build: (document) => {
                counts.builds += 1
                return [document.createElement(tag)]
            },
            mount: () => {
                counts.mounts += 1
                const scope = new Scope()
                scope.stops.push(() => {
                    counts.stops += 1
                })
                return scope
            },
        }),
    }
    return counts
}

// A region between two anchors in a fresh host, holding `painted` where the server painted one.
function regionIn(painted?: string): { host: HTMLElement; region: Region } {
    const host = document.createElement('div')
    const open = document.createComment('[')
    const close = document.createComment(']')
    host.append(open)
    if (painted !== undefined) host.append(document.createElement(painted))
    host.append(close)
    return { host, region: { open, close } }
}

function tags(host: HTMLElement): string[] {
    const out: string[] = []
    for (const node of host.childNodes)
        if (node.nodeType === 1) out.push((node as Element).localName)
    return out
}

test('the first swap hydrates the painted arm, and a later one replaces it', () => {
    const { host, region } = regionIn('p')
    const p = counted('p')
    const em = counted('em')
    const arms = new ArmRegion(region, new Scope(), [p.arm, em.arm], true)

    arms.show(0)
    // Hydrated: the server's `<p>` stays, nothing is built, and the arm is mounted over it.
    expect(tags(host)).toEqual(['p'])
    expect([p.builds, p.mounts]).toEqual([0, 1])

    arms.show(0)
    // The arm standing: no swap at all.
    expect([p.builds, p.mounts]).toEqual([0, 1])

    arms.show(1)
    expect(tags(host)).toEqual(['em'])
    // The old arm's bindings stopped once, the new one built and mounted once.
    expect([p.stops, em.builds, em.mounts]).toEqual([1, 1, 1])
})

test('the first swap fills a region nobody painted — 41.4', () => {
    const { host, region } = regionIn()
    const p = counted('p')
    new ArmRegion(region, new Scope(), [p.arm], true).show(0)
    expect(tags(host)).toEqual(['p'])
    expect([p.builds, p.mounts]).toEqual([1, 1])
})

test('arms that bind nothing are only filled', () => {
    const { host, region } = regionIn('p')
    const p = counted('p')
    const em = counted('em')
    const owner = new Scope()
    const arms = new ArmRegion(region, owner, [p.arm, em.arm], false)
    arms.show(0)
    arms.show(1)
    expect(tags(host)).toEqual(['em'])
    expect([p.mounts, em.mounts, em.builds]).toEqual([0, 0, 1])
    // No scope was made to hold an arm, so the owner holds nothing.
    expect(owner.children).toBeUndefined()
})

test('a scope the owner stops stops the standing arm', () => {
    const { region } = regionIn('p')
    const p = counted('p')
    const owner = new Scope()
    new ArmRegion(region, owner, [p.arm], true).show(0)
    owner.stop()
    expect(p.stops).toBe(1)
})

test('a chosen component mounts itself, and an absent one leaves the region empty — 32.34, 32.36', () => {
    const { host, region } = regionIn('b')
    let mounted = 0
    const Child = (root: Region): Scope => {
        mounted += 1
        // 32.17 — a child handed an empty region fills it itself.
        if (root.open.nextSibling === root.close)
            root.close.before(document.createElement('i'))
        return new Scope()
    }
    const chosen = new ChosenRegion(region, new Scope(), {}, null)
    chosen.show(Child)
    // Hydrated: the painted `<b>` stays.
    expect(tags(host)).toEqual(['b'])
    chosen.show(null)
    expect(tags(host)).toEqual([])
    chosen.show(Child)
    expect(tags(host)).toEqual(['i'])
    expect(mounted).toBe(2)
})

// 41.24 — A COMPONENT THE SERVER PAINTED WHERE THE CLIENT CHOSE NONE is emptied, not left standing
// with nothing bound to it. THE REVERT: answer `false` from `ChosenRegion.paintedOther`; this
// reports `['b']` where `[]` is due, and no warning.
test('a painted component the client chose none for is emptied — 41.24', () => {
    const { host, region } = regionIn('b')
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '))
    try {
        new ChosenRegion(region, new Scope(), {}, null).show(null)
    } finally {
        console.warn = warn
    }
    expect({
        standing: tags(host),
        warnings: warned.filter((line) => line.includes('abide:hydrate'))
            .length,
    }).toEqual({ standing: [], warnings: 1 })
})

// 41.24 — AN `{#if}` THE SERVER PAINTED NAMES ITS ARM, and a first swap to another fills the one
// chosen; an open naming none (`[`, a region the browser filled) is adopted as it stands — the
// first test above. THE REVERT: answer `false` from `ArmRegion.paintedOther`; this reports the
// painted `['p']` standing where `['em']` is due, with `em` bound to it.
test('a first swap to an arm the open does not name fills it — 41.24', () => {
    const { host, region } = regionIn('p')
    region.open.data = '[0'
    const p = counted('p')
    const em = counted('em')
    const warn = console.warn
    console.warn = () => {}
    try {
        new ArmRegion(region, new Scope(), [p.arm, em.arm], true).show(1)
    } finally {
        console.warn = warn
    }
    expect(tags(host)).toEqual(['em'])
    expect([em.builds, em.mounts, p.mounts]).toEqual([1, 1, 0])
})
