import { expect, test } from 'bun:test'
import {
    attributeOf,
    type DocsPage,
    docsPages,
    type Fence,
    fencesOf,
    tagEnd,
} from './docsPages.ts'

const EXCERPT = / — excerpt$/

/** A label is an ADDRESS when it is a path rather than one of BRAND's four side words. */
function isAddress(label: string): boolean {
    return label.startsWith('#') || label.includes('/')
}

/** How many of a page's sections teach with a hand-written `<Code>` and embed no example. */
function fenceOnlySections(page: DocsPage): number {
    const withExample = new Set<string>()
    let section = ''
    for (const match of page.source.matchAll(/<(Section|Example)\b/g)) {
        if (match[1] === 'Example') withExample.add(section)
        else
            section = attributeOf(
                page.source.slice(
                    match.index,
                    tagEnd(page.source, match.index, false),
                ),
                'title',
            )
    }
    const teaching = new Set<string>()
    for (const fence of fencesOf(page))
        if (fence.section && fence.language && !withExample.has(fence.section))
            teaching.add(fence.section)
    return teaching.size
}

// 40.17 AND 40.6. A section that teaches with a fence it wrote by hand embeds no `<Example>` and
// quotes nothing that runs, so the code under its heading is a claim no build checks. Revert-verified:
// one fenced section under a heading with no card names its page.
test('no teaching page has a section that teaches with a fence alone', async () => {
    const fenced: string[] = []
    for (const page of await docsPages())
        if (page.covers?.length && fenceOnlySections(page))
            fenced.push(page.route)
    expect(fenced).toEqual([])
})

// BRAND's spine: an ADDRESS a reader cannot open is a claim. A `<Snippet>` derives its
// caption from a file the build reads; a hand-written fence captioned with a path derives nothing,
// and naming a file that happens to exist in the docs app is no better — every one that did,
// showed something else. A fence takes a bare side word. Revert-verified: one `ts #server/…`
// fence names its page.
test('no page captions a hand-written fence with an address', async () => {
    const captioned: string[] = []
    for (const page of await docsPages())
        for (const fence of fencesOf(page))
            if (isAddress(fence.caption))
                captioned.push(`${page.route}: ${fence.caption}`)
    expect(captioned).toEqual([])
})

// A caption WITHOUT `— excerpt` claims the whole file, so every other fence of that address,
// on any page, can only show lines it has. Revert-verified: unmarking an excerpt's caption -> 14 fences carry lines that whole file lacks.
test('a fence claiming a whole file agrees with every fence of that address', async () => {
    const byAddress = new Map<string, { where: string; fence: Fence }[]>()
    for (const page of await docsPages())
        for (const fence of fencesOf(page)) {
            if (!isAddress(fence.caption)) continue
            const address = fence.caption.replace(EXCERPT, '')
            const list = byAddress.get(address) ?? []
            list.push({ where: page.route, fence })
            byAddress.set(address, list)
        }

    const contradicted: string[] = []
    for (const [address, fences] of byAddress)
        for (const whole of fences) {
            if (EXCERPT.test(whole.fence.caption)) continue
            const lines = new Set(
                whole.fence.code.split('\n').map((line) => line.trim()),
            )
            for (const other of fences) {
                if (other === whole) continue
                for (const line of other.fence.code.split('\n')) {
                    const trimmed = line.trim()
                    if (!trimmed || trimmed === '…' || lines.has(trimmed))
                        continue
                    contradicted.push(
                        `${address}: ${whole.where} claims the whole file, ${other.where} shows ${trimmed}`,
                    )
                    break
                }
            }
        }
    expect(contradicted).toEqual([])
})
