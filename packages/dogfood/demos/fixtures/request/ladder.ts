// Text only: every rung here reads a scope, and there is no scope on a page being looked at.
import type { Example } from 'harness'
import ONE from './1-the-request-being-answered.ts?source'
import TWO from './2-what-the-caller-sent.ts?source'
import THREE from './3-your-own-store.ts?source'
import FOUR from './4-the-thread-through-the-logs.ts?source'
import FIVE from './5-a-nonce-per-request.ts?source'
import SIX from './6-and-the-policy-that-needs-it.ts?source'

export const LADDER: Example[] = [
    { adds: 'the Request itself, as an ambient rather than a parameter', of: ['request'], source: ONE },
    { adds: 'what the caller sent, parsed once and held', of: ['cookies'], source: TWO },
    { adds: 'your own store, one per request', of: ['bag'], source: THREE },
    { adds: 'the id that ties this request’s log lines to the caller’s', of: ['trace'], source: FOUR },
    { adds: 'one unguessable value per request, the same for every asker', of: ['nonce'], source: FIVE },
    { adds: 'and the policy that makes that value mean something', of: ['csp'], source: SIX },
]
