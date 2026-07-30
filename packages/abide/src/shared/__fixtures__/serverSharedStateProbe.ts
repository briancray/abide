// Probe: `state.shared` on the side with NO DOM — i.e. the real abide server.
//
// Run as a child `bun` with no preload, so there is no `document` and `makeShared` takes its server
// branch. That branch cannot be reached from `bun test`: `test/happydom.ts` installs happy-dom's globals
// and the suite therefore always has a `document`, which is deliberate (it is what makes the cross-tab
// tests possible) and leaves the branch preventing a CROSS-REQUEST STATE LEAK with no coverage at all.
//
// Two "renders" ask for the same key. On the client they must share one atom; here they must not — a
// process-global registry on the server would hand one request's state to the next.

import { state } from '../state.ts'

if (typeof document !== 'undefined') {
    throw new Error('this probe must run with no DOM — it exists to reach the server branch')
}

const first = state.shared('leak-probe', 'initial')
const second = state.shared('leak-probe', 'initial')

first.set('written by the first render')

console.log(
    `@@${JSON.stringify({
        hadDom: false,
        first: first(),
        // The whole claim: the second render still sees its own `initial`.
        second: second(),
        // And a third, asking after the write, starts from `initial` too — the registry is not merely
        // per-pair, it is per-call.
        third: state.shared('leak-probe', 'initial')(),
    })}`,
)
