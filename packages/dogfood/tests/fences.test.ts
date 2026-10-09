import { expect, test } from 'bun:test'
import { type Page, readPages } from '../scripts/readContent.ts'
import { EXAMPLE, EXCERPT } from '../scripts/renderMarkdown.ts'

const FENCE = /^```(\S*)[ \t]*(.*)$/

type Fence = { language: string; label: string; body: string; section: string }

/** Every hand-written fence on a page, with the `##` section it sits in. */
function fencesOf(page: Page): Fence[] {
    const fences: Fence[] = []
    let open: Fence | undefined
    let section = ''
    for (const line of page.body.split('\n')) {
        const fence = FENCE.exec(line)
        if (open) {
            if (fence) {
                fences.push(open)
                open = undefined
            } else open.body += `${line}\n`
            continue
        }
        if (fence) {
            open = {
                language: fence[1] ?? '',
                label: (fence[2] ?? '').trim(),
                body: '',
                section,
            }
            continue
        }
        if (line.startsWith('## ')) section = line
    }
    return fences
}

/** A label is an ADDRESS when it is a path rather than one of BRAND's four side words. */
function isAddress(label: string): boolean {
    return label.startsWith('#') || label.includes('/')
}

/** How many of a page's `##` sections teach with a hand-written fence and embed no example. */
function fenceOnlySections(page: Page): number {
    const withExample = new Set<string>()
    let section = ''
    let fenced = false
    for (const line of page.body.split('\n')) {
        if (FENCE.test(line)) fenced = !fenced
        else if (!fenced && line.startsWith('## ')) section = line
        else if (!fenced && EXAMPLE.test(line.trim())) withExample.add(section)
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
// `{% example %}` and quotes nothing that runs, so the code under its heading is a claim no build
// checks. Converting a section lowers its page's number here; a page that gains one fails, which
// is the moment somebody notices. Both directions bind, so the list cannot creep back up to a
// number it once had. Revert-verified: one more fenced section under a heading -> `up` names it.
const FENCE_ONLY_SECTIONS = new Map<string, number>([
    ['app/configure-the-app', 1],
    ['app/follow-a-request-across-services', 4],
    ['app/know-when-the-browser-goes-offline', 2],
    ['app/know-who-is-calling', 1],
    ['app/lock-down-what-the-page-may-load', 1],
    ['app/read-the-incoming-request', 1],
    ['app/record-what-happened', 2],
    ['app/run-code-at-start-and-stop', 1],
    ['machines/put-a-claude-assistant-on-your-site', 2],
    ['pages/add-a-page', 1],
    ['pages/animate-from-one-page-to-the-next', 1],
    ['pages/give-pages-the-same-chrome', 1],
    ['pages/render-a-document-yourself', 1],
    ['pages/set-the-title-and-social-preview', 1],
    ['server/answer-with-something-other-than-json', 1],
    ['server/change-something-on-the-server', 1],
    ['server/check-what-callers-send-you', 4],
    ['server/decide-who-may-call-what', 2],
    ['server/find-the-url-a-handler-answers-on', 4],
    ['server/keep-a-room-of-callers-in-sync', 3],
    ['server/put-a-ceiling-on-a-request', 1],
    ['server/read-data-without-writing-an-api', 2],
    ['server/refuse-a-request-and-say-why', 3],
    ['server/send-data-as-it-arrives', 2],
    ['ship/call-your-app-from-a-test', 1],
    ['start/how-a-page-becomes-html', 4],
    ['start/what-abide-is-for', 1],
    ['templates/bind-a-form-to-state', 4],
    ['templates/reuse-a-piece-of-markup', 4],
    ['templates/scope-styles-to-a-component', 1],
    ['values/decide-when-a-value-reloads', 2],
    ['values/do-something-when-a-value-changes', 1],
    ['values/keep-a-value-outside-the-process', 2],
    ['values/keep-the-last-few-values', 1],
    ['values/share-one-value-across-components', 1],
])

test('no teaching page has more fence-only sections than recorded', async () => {
    const counted = new Map<string, number>()
    for (const page of await readPages()) {
        if (!page.covers.length) continue
        const count = fenceOnlySections(page)
        if (count) counted.set(page.slug, count)
    }
    expect(drifted(FENCE_ONLY_SECTIONS, counted)).toEqual([])
})

// BRAND's spine: an ADDRESS a reader cannot open is a claim. A `{% snippet %}` derives its
// caption from a file the build reads; a hand-written fence captioned with a path derives nothing,
// and naming a file that happens to exist in the docs app is no better — every one that did,
// showed something else. Until its example exists a fence takes a bare side word. The count
// only shrinks. Revert-verified: one more `ts #server/…` fence -> `up` names the page.
const ADDRESS_CAPTIONED_FENCES = new Map<string, number>([
    ['app/know-when-the-browser-goes-offline', 2],
    ['app/lock-down-what-the-page-may-load', 1],
    ['app/read-the-incoming-request', 1],
    ['machines/keep-a-handler-off-a-surface', 1],
    ['machines/put-a-claude-assistant-on-your-site', 1],
    ['pages/add-a-page', 1],
    ['pages/animate-from-one-page-to-the-next', 1],
    ['pages/give-pages-the-same-chrome', 1],
    ['pages/link-to-another-page', 1],
    ['pages/set-the-title-and-social-preview', 2],
    ['pages/show-a-page-when-something-fails', 1],
    ['reference/abide-files', 2],
    ['reference/ambient-values', 2],
    ['reference/routing', 1],
    ['reference/transports', 2],
    ['server/answer-with-something-other-than-json', 1],
    ['server/change-something-on-the-server', 1],
    ['server/check-what-callers-send-you', 4],
    ['server/find-the-url-a-handler-answers-on', 1],
    ['server/index', 1],
    ['server/keep-a-room-of-callers-in-sync', 4],
    ['server/read-data-without-writing-an-api', 2],
    ['server/refuse-a-request-and-say-why', 1],
    ['server/send-data-as-it-arrives', 1],
    ['start/how-a-page-becomes-html', 2],
    ['start/what-abide-is-for', 1],
    ['start/your-first-page', 4],
    ['templates/bind-a-form-to-state', 4],
    ['templates/reuse-a-piece-of-markup', 7],
    ['values/share-one-value-across-components', 1],
])

test('no page captions more hand-written fences with an address than recorded', async () => {
    const counted = new Map<string, number>()
    for (const page of await readPages()) {
        let count = 0
        for (const fence of fencesOf(page))
            if (isAddress(fence.label)) count += 1
        if (count) counted.set(page.slug, count)
    }
    expect(drifted(ADDRESS_CAPTIONED_FENCES, counted)).toEqual([])
})

// A caption WITHOUT `— excerpt` claims the whole file, so every other fence of that address,
// on any page, can only show lines it has. Revert-verified: unmarking `#server/app.ts` in
// run-code-at-start-and-stop -> 14 fences carry lines that whole file lacks.
test('a fence claiming a whole file agrees with every fence of that address', async () => {
    const byAddress = new Map<string, { where: string; fence: Fence }[]>()
    for (const page of await readPages())
        for (const fence of fencesOf(page)) {
            if (!isAddress(fence.label)) continue
            const address = fence.label.replace(EXCERPT, '')
            const list = byAddress.get(address) ?? []
            list.push({ where: page.slug, fence })
            byAddress.set(address, list)
        }

    const contradicted: string[] = []
    for (const [address, fences] of byAddress)
        for (const whole of fences) {
            if (EXCERPT.test(whole.fence.label)) continue
            const lines = new Set(
                whole.fence.body.split('\n').map((line) => line.trim()),
            )
            for (const other of fences) {
                if (other === whole) continue
                for (const line of other.fence.body.split('\n')) {
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
