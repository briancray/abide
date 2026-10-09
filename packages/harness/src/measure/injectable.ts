// THE BROWSER ARM'S ENTRY. Built to one file so `bun test` imports the source and a
// browser is injected with the same bytes — same code, same clock, same batch sizing
// in both substrates, which is the only reason this lane is worth having in two
// places at all.
//
// It publishes on the global rather than exporting: it runs as a classic script at
// document-start, before any page code, which is the only moment the patches can be
// installed.
import { measure } from './measure.ts'
import { install, patchSet } from './install.ts'

install()
;(
    globalThis as {
        __HARNESS_MEASURE__?: {
            measure: typeof measure
            patchSet: typeof patchSet
        }
    }
).__HARNESS_MEASURE__ = { measure, patchSet }
