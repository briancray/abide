// The prover itself — not the rungs it is pointed at.
//
// The per-rung sweep lives in a BROWSER, on `/docs/<callable>`, and that is an architectural fact
// rather than a preference. A ladder is a real module with real module-scope effects, and two things
// that mount the same rung in one process are not independent: `verbs`' own suite asserts that a cold
// load shows its placeholder, and a sweep that had already mounted that rung warmed the very cell the
// claim is about. The app is arranged around the same fact — `/docs/<callable>` pulls only the ladders
// that callable's rungs are in, so a page mounts each rung once and nothing else in the process has an
// opinion about it. `e2e/docs.e2e.ts` is where the sweep is asserted, over all forty-five pages.
//
// What is left here is the claim that could not be made there: that the prover can still SEE a
// rebuild. Every rung passing tells you nothing if the counters stopped counting.

import { expect, test } from 'bun:test'
import { html, type TemplateResult } from 'abide'
import { renderToString } from 'abide/server/internal'
import { hydrate } from 'abide/ui'
import { container } from 'harness'
import { measure } from 'harness/measure'

test('the prover can still SEE a rebuild — the negative control', async () => {
    // A gate green on its first run has not been shown to test anything, and this one cannot be
    // checked by reverting a fix: there is no fix, the rungs were already right. So the control is
    // permanent instead — a subject whose server markup is deliberately not what the client builds.
    // If the counters ever stop noticing a rebuild, this goes green and the whole sweep is worthless.
    const served = container()
    served.innerHTML = await renderToString(html`<p>what the server wrote</p>`, { hydratable: true })

    const other = (): TemplateResult => html`<section>something else entirely</section>`
    const work = measure(() => void hydrate(served, other))
    served.remove()

    const rebuilt = work.createElement + work.remove + work.textWrite + work.setAttribute
    expect(rebuilt, 'the markup disagreed and nothing was counted — the prover is blind').toBeGreaterThan(0)
})
