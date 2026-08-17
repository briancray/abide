// The `lifecycle` ladder. Three of these four rungs are HOOKS, and a hook has nothing to render by
// itself — so each browser half asks THIS PROCESS what its own hook did, and each of those hooks is
// really declared, on `packages/dogfood/app.ts`, in exactly the form the rung shows.
//
// Rung 4's server half is the endpoint the other three ask through. That is the ladder working: the
// module a reader meets last is the one the previews above it have been calling all along.
import type { Example } from 'harness'
import One from './1-boot-is-an-onion.abide'
import ONE_CLIENT from './1-boot-is-an-onion.abide?source'
import ONE from './1-boot-is-an-onion.ts?source'
import Two from './2-wrap-every-request.abide'
import TWO_CLIENT from './2-wrap-every-request.abide?source'
import TWO from './2-wrap-every-request.ts?source'
import Three from './3-when-a-request-throws.abide'
import THREE_CLIENT from './3-when-a-request-throws.abide?source'
import THREE from './3-when-a-request-throws.ts?source'
import Four from './4-ask-what-is-listening.abide'
import FOUR_CLIENT from './4-ask-what-is-listening.abide?source'
import FOUR from '#server/rpc/docs/lifecycle/ask-what-is-listening.ts?source'

export const LADDER: Example[] = [
    // One rung, two names: the file declares both hooks, because the mirror on the way out is what
    // makes the onion an onion rather than a callback that happens to wrap.
    {
        adds: 'boot is an ONION, so the socket binds INSIDE it',
        of: ['onStart', 'onStop'],
        source: ONE,
        client: ONE_CLIENT,
        view: One,
    },
    {
        adds: 'wrap every request, outermost first',
        of: ['middleware'],
        source: TWO,
        client: TWO_CLIENT,
        view: Two,
    },
    {
        adds: 'answer the ones that threw — what the hook returns IS the response',
        of: ['onError'],
        source: THREE,
        client: THREE_CLIENT,
        view: Three,
    },
    {
        adds: 'ask what is listening — a PROCESS fact, so it is an ambient too',
        of: ['server'],
        source: FOUR,
        client: FOUR_CLIENT,
        view: Four,
    },
]
