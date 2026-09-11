// THE BROWSER ARM'S ENTRY. Built to one file so `bun test` imports the source and a
// browser is injected with the same bytes — same code, same clock, same batch sizing
// in both substrates, which is the only reason this lane is worth having in two
// places at all.
//
// It publishes on the global rather than exporting: it runs as a classic script at
// document-start, before any page code, which is also the only moment the patches can
// be installed and the only moment the LOAD can start being counted.
import { armCase, disarmCase, measure } from './case.ts'
import { time } from './index.ts'
import { install, patchSet } from './install.ts'
import { profile, watchLongTasks } from './profile.ts'
import type { Reading } from './Reading.ts'

install()
watchLongTasks()
// THE LOAD CASE IS NOT ARMED HERE. Counting a page load is something the DOCUMENTATION
// does — 40.21 — and arming it in the lane made `measure()` throw "already armed" for
// every other caller in the same page, which is what the both-substrates gate does.
// The caller that wants a load counted arms one; the lane just offers the pair.
;(
    globalThis as {
        __HARNESS_MEASURE__?: {
            measure: typeof measure
            patchSet: typeof patchSet
            time: typeof time
            profile: typeof profile
            armCase: typeof armCase
            disarmCase: typeof disarmCase
        }
        __HARNESS_READING__?: Reading
    }
).__HARNESS_MEASURE__ = {
    measure,
    patchSet,
    time,
    profile,
    armCase,
    disarmCase,
}
