// Text only: this capability has nothing to render.
import type { Example } from 'harness'
import ONE from './1-boot-is-an-onion.ts?source'
import TWO from './2-wrap-every-request.ts?source'
import THREE from './3-when-a-request-throws.ts?source'
import FOUR from './4-ask-what-is-listening.ts?source'

export const LADDER: Example[] = [
    // One rung, two names: the file declares both hooks, because the mirror on the way out is what
    // makes the onion an onion rather than a callback that happens to wrap.
    { adds: 'boot is an ONION, so the socket binds INSIDE it', of: ['onStart', 'onStop'], source: ONE },
    { adds: 'wrap every request, outermost first', of: ['middleware'], source: TWO },
    { adds: 'answer the ones that threw — what the hook returns IS the response', of: ['onError'], source: THREE },
    { adds: 'ask what is listening — a PROCESS fact, so it is an ambient too', of: ['server'], source: FOUR },
]
