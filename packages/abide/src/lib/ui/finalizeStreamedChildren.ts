import { RANGE_CLOSE, RANGE_OPEN } from './runtime/RANGE_MARKER.ts'
import type { ResumeEntry } from './runtime/RESUME.ts'
import type { SsrAwait, SsrRender } from './runtime/types/SsrRender.ts'
import type { FlightPromise } from './flight.ts'

/* Comment-wrapped range markers — imported from the shared constant (not a local literal) so the
   inline branch below can never drift from `generateSSR`'s own range emit. */
const OPEN = `<!--${RANGE_OPEN}-->`
const CLOSE = `<!--${RANGE_CLOSE}-->`

/* One hoistable child render staged by generateSSR: the reserved index in its output array, the
   array itself, the child's render-path (the streamed boundary id), and its in-flight render. */
export type StagedChild = {
    slot: number
    out: string[]
    id: string
    flight: FlightPromise
}

/*
The ADR-0039 WHEN-TO-STREAM decision, run once after a component's body walk (compileSSR emits
`await $$finalizeStreamedChildren($childSlots, $awaits, $resume)` before the render returns). Each
hoistable child was started as an isolated `$$flight` in the prefix and its output position RESERVED
(an empty `$out` slot); here we fill that slot per child:

- A flight that has already SETTLED (a synchronous / warm-cache child, or a fast read) inlines its
  html into the reserved slot as `<!--[-->…<!--]-->` — BYTE-IDENTICAL to the pre-ADR-0039 inline
  `await Child.render()` path, so an all-fast page's wire and hydration are unchanged. Its awaits /
  resume merge exactly as the inline path did.
- A flight settled REJECTED rethrows here — same as a rejecting inline await (500 before flush).
- A still-PENDING flight (genuine I/O) STREAMS: the slot gets an empty `abide:await:CHILDPATH`
  boundary, and an html-only SsrAwait is pushed so `renderToStream` flushes the shell now and streams
  the child's fragment when it settles (its own nested awaits/resume compose through the same drain).

Timing: one microtask drain settles every synchronous child; a single shared macrotask is paid ONLY
if some child is still pending after that (a page whose children are all fast never reaches it), so
the inline fast path costs one microtask and a genuinely-slow child — which was going to block the
shell anyway — trades ~one tick for a progressively-flushed shell.
*/
// @documentation plumbing
export async function finalizeStreamedChildren(
    slots: StagedChild[],
    awaits: SsrAwait[],
    resume: Record<string, ResumeEntry>,
): Promise<void> {
    if (slots.length === 0) {
        return
    }
    await Promise.resolve()
    if (slots.some((staged) => !staged.flight.settled)) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    for (const staged of slots) {
        if (staged.flight.settled && staged.flight.error === undefined) {
            const rendered = staged.flight.value as SsrRender
            staged.out[staged.slot] = OPEN + rendered.html + CLOSE
            for (const nested of rendered.awaits) {
                awaits.push(nested)
            }
            Object.assign(resume, rendered.resume)
        } else if (staged.flight.settled) {
            throw staged.flight.error
        } else {
            staged.out[staged.slot] =
                `<!--abide:await:${staged.id}--><!--/abide:await:${staged.id}-->`
            awaits.push({
                id: staged.id,
                htmlOnly: true,
                promise: () => staged.flight,
                then: async (rendered) => {
                    for (const nested of (rendered as SsrRender).awaits) {
                        awaits.push(nested)
                    }
                    Object.assign(resume, (rendered as SsrRender).resume)
                    return (rendered as SsrRender).html
                },
            })
        }
    }
}
