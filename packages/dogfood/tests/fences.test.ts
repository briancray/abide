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

/** The pages whose count differs from the one recorded, both ways. */
function drifted(
    recorded: Map<string, number>,
    counted: Map<string, number>,
): string[] {
    const out: string[] = []
    for (const slug of new Set([...recorded.keys(), ...counted.keys()])) {
        const was = recorded.get(slug) ?? 0
        const now = counted.get(slug) ?? 0
        if (now > was) out.push(`${slug}: ${was} -> ${now}, up`)
        else if (now < was)
            out.push(
                `${slug}: ${was} -> ${now}, down — lower the recorded number`,
            )
    }
    return out
}

// 40.17 AND 40.6, AS A RATCHET. A section that teaches with a fence it wrote by hand embeds no
// `<Example>` and quotes nothing that runs, so the code under its heading is a claim no build
// checks. Converting a section lowers its page's number here; a page that gains one fails, which
// is the moment somebody notices. Both directions bind, so the list cannot creep back up to a
// number it once had. Revert-verified: one more fenced section under a heading -> `up` names it.
const FENCE_ONLY_SECTIONS = new Map<string, number>([
    ['/app/configure-the-app', 1],
    ['/app/follow-a-request-across-services', 4],
    ['/app/know-when-the-browser-goes-offline', 2],
    ['/app/know-who-is-calling', 1],
    ['/app/lock-down-what-the-page-may-load', 1],
    ['/app/read-the-incoming-request', 1],
    ['/app/record-what-happened', 2],
    ['/app/run-code-at-start-and-stop', 1],
    ['/machines/put-a-claude-assistant-on-your-site', 2],
    ['/pages/add-a-page', 1],
    ['/pages/animate-from-one-page-to-the-next', 1],
    ['/pages/give-pages-the-same-chrome', 1],
    ['/pages/set-the-title-and-social-preview', 1],
    ['/data/answer-with-something-other-than-json', 1],
    ['/data/change-something-on-the-server', 1],
    ['/data/check-what-callers-send-you', 4],
    ['/data/decide-who-may-call-what', 2],
    ['/data/find-the-url-a-handler-answers-on', 4],
    ['/data/keep-a-room-of-callers-in-sync', 2],
    ['/data/put-a-ceiling-on-a-request', 1],
    ['/data/read-data-without-writing-an-api', 2],
    ['/data/refuse-a-request-and-say-why', 3],
    ['/data/send-data-as-it-arrives', 2],
    ['/ship/call-your-app-from-a-test', 1],
    // A native menu bar, a bundle's settings and a page rendered before the app runs have no
    // browser to render in, so no `<Example>` can run them.
    ['/ship/ship-a-desktop-app', 3],
    ['/start/how-a-page-becomes-html', 4],
    ['/start/what-abide-is-for', 1],
    ['/templates/bind-a-form-to-state', 4],
    ['/templates/reuse-a-piece-of-markup', 4],
    ['/templates/scope-styles-to-a-component', 1],
    ['/values/decide-when-a-value-reloads', 2],
    ['/values/do-something-when-a-value-changes', 1],
    ['/values/keep-a-value-outside-the-process', 2],
    ['/values/keep-the-last-few-values', 1],
    ['/values/share-one-value-across-components', 1],
])

test('no teaching page has more fence-only sections than recorded', async () => {
    const counted = new Map<string, number>()
    for (const page of await docsPages()) {
        if (!page.covers?.length) continue
        const count = fenceOnlySections(page)
        if (count) counted.set(page.route, count)
    }
    expect(drifted(FENCE_ONLY_SECTIONS, counted)).toEqual([])
})

// BRAND's spine: an ADDRESS a reader cannot open is a claim. A `<Snippet>` derives its
// caption from a file the build reads; a hand-written fence captioned with a path derives nothing,
// and naming a file that happens to exist in the docs app is no better — every one that did,
// showed something else. Until its example exists a fence takes a bare side word. The count
// only shrinks. Revert-verified: one more `ts #server/…` fence -> `up` names the page.
const ADDRESS_CAPTIONED_FENCES = new Map<string, number>([
    ['/app/know-when-the-browser-goes-offline', 2],
    ['/app/lock-down-what-the-page-may-load', 1],
    ['/app/read-the-incoming-request', 1],
    ['/machines/keep-a-handler-off-a-surface', 1],
    ['/machines/put-a-claude-assistant-on-your-site', 1],
    ['/pages/add-a-page', 1],
    ['/pages/animate-from-one-page-to-the-next', 1],
    ['/pages/give-pages-the-same-chrome', 1],
    ['/pages/link-to-another-page', 1],
    ['/pages/set-the-title-and-social-preview', 2],
    ['/pages/show-a-page-when-something-fails', 1],
    ['/reference/abide-files', 2],
    ['/reference/ambient-values', 2],
    ['/reference/routing', 1],
    ['/reference/transports', 1],
    ['/data/answer-with-something-other-than-json', 1],
    ['/data/change-something-on-the-server', 1],
    ['/data/check-what-callers-send-you', 4],
    ['/data/find-the-url-a-handler-answers-on', 1],
    ['/data', 1],
    ['/data/read-data-without-writing-an-api', 2],
    ['/data/refuse-a-request-and-say-why', 1],
    ['/data/send-data-as-it-arrives', 1],
    ['/start/how-a-page-becomes-html', 2],
    ['/start/what-abide-is-for', 1],
    ['/start/your-first-page', 3],
    ['/templates/bind-a-form-to-state', 4],
    ['/templates/reuse-a-piece-of-markup', 7],
    ['/values/share-one-value-across-components', 1],
])

test('no page captions more hand-written fences with an address than recorded', async () => {
    const counted = new Map<string, number>()
    for (const page of await docsPages()) {
        let count = 0
        for (const fence of fencesOf(page))
            if (isAddress(fence.caption)) count += 1
        if (count) counted.set(page.route, count)
    }
    expect(drifted(ADDRESS_CAPTIONED_FENCES, counted)).toEqual([])
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
