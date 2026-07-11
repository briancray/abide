import { describe, expect, test } from 'bun:test'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import type { SsrAwait, SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'

/*
ADR-0039 spike — the STANDALONE UNIT (streamed child component). A hoistable child already compiles
to its own render function returning `{ html, awaits, resume }` and runs isolated (ADR-0037). This
spike proves the SERVER half of streaming it out-of-order: instead of `await`ing the child inline
(buffering its html into the shell), register it on `$awaits` as an html-only boundary — the shell
flushes with a pending placeholder, and the child's fragment streams in when its render settles, its
OWN nested awaits/resume composing through the same drain. No compiler change here; this validates
the runtime mechanism the ADR's codegen would target. (The client-side adopter is the remaining work
the ADR scopes.)
*/

async function drain(render: () => SsrRender): Promise<string[]> {
    const chunks: string[] = []
    for await (const chunk of renderToStream(render)) {
        chunks.push(chunk)
    }
    return chunks
}

describe('standalone-unit component streaming (server half)', () => {
    test('shell flushes first, then the child fragment streams html-only (no bogus resume)', async () => {
        /* The child render resolves after a tick with its html + (here) no nested awaits. */
        const childFlight = () =>
            new Promise<SsrRender>((resolve) =>
                setTimeout(
                    () =>
                        resolve({
                            html: '<article>child</article>',
                            awaits: [],
                            state: {},
                            resume: {},
                        }),
                    5,
                ),
            )
        const boundary: SsrAwait = {
            id: 'page/0:0',
            htmlOnly: true,
            promise: childFlight,
            /* The streamed child boundary's `then` returns the child's html and (for nested
               composition) would push child.awaits / Object.assign child.resume — none here. */
            then: async (rendered) => (rendered as SsrRender).html,
        }
        const render = (): SsrRender => ({
            html: '<main><!--abide:await:page/0:0--><!--/abide:await:page/0:0--></main>',
            awaits: [boundary],
            state: {},
            resume: {},
        })
        const chunks = await drain(render)

        // 1. shell flushed FIRST, with the pending (empty) boundary — before the child settled.
        expect(chunks[0]).toContain('<main><!--abide:await:page/0:0-->')
        expect(chunks[0]).not.toContain('<article>child</article>')
        // 2. the child fragment streamed as an abide-resolve keyed by the boundary id.
        const fragment = chunks.slice(1).join('')
        expect(fragment).toContain('<abide-resolve data-id="page/0:0">')
        expect(fragment).toContain('<article>child</article>')
        // 3. html-only: NO resume <script> for the component boundary (it re-mounts client-side).
        expect(fragment).not.toContain('<script type="application/json">')
    })

    test("a nested {#await} INSIDE the streamed child composes (child's awaits ride the drain)", async () => {
        /* The child, when it settles, registers its OWN streaming await onto the shared $awaits —
           renderToStream re-scans after every settle, so the nested fragment streams too. */
        const outerAwaits: SsrAwait[] = []
        const nested: SsrAwait = {
            id: 'page/0:0/0',
            promise: () => Promise.resolve('N'),
            then: async (v) => `<span>nested:${v as string}</span>`,
        }
        const boundary: SsrAwait = {
            id: 'page/0:0',
            htmlOnly: true,
            promise: () =>
                Promise.resolve<SsrRender>({
                    html: '<article>child</article>',
                    awaits: [nested],
                    state: {},
                    resume: {},
                }),
            then: async (rendered) => {
                for (const a of (rendered as SsrRender).awaits) {
                    outerAwaits.push(a)
                }
                return (rendered as SsrRender).html
            },
        }
        outerAwaits.push(boundary)
        const render = (): SsrRender => ({
            html: '<main><!--abide:await:page/0:0--><!--/abide:await:page/0:0--></main>',
            awaits: outerAwaits,
            state: {},
            resume: {},
        })
        const all = (await drain(render)).join('')
        // both the child fragment AND the child's nested await streamed, keyed by their paths.
        expect(all).toContain('data-id="page/0:0"')
        expect(all).toContain('<article>child</article>')
        expect(all).toContain('data-id="page/0:0/0"')
        expect(all).toContain('<span>nested:N</span>')
    })
})
