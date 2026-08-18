// The `request` ladder. Every rung reads the scope, and a scope is something only a server has — so
// every rung is TWO files: a real endpoint under `server/rpc/docs/request/`, and the browser half that
// calls it. Pressing the button in a preview is what opens the request the rung is about.
//
// Rungs 7 and 11 are the exceptions and say why in their own halves: both are declared as MIDDLEWARE
// rather than as an endpoint, so what the button reads is what this app's own onion really did.
import type { Example } from 'harness'
import One from './1-the-request-being-answered.abide'
import ONE_CLIENT from './1-the-request-being-answered.abide?source'
import Two from './2-what-the-caller-sent.abide'
import TWO_CLIENT from './2-what-the-caller-sent.abide?source'
import Three from './3-your-own-store.abide'
import THREE_CLIENT from './3-your-own-store.abide?source'
import Four from './4-the-thread-through-the-logs.abide'
import FOUR_CLIENT from './4-the-thread-through-the-logs.abide?source'
import Five from './5-a-nonce-per-request.abide'
import FIVE_CLIENT from './5-a-nonce-per-request.abide?source'
import Six from './6-the-policy-already-there.abide'
import SIX_CLIENT from './6-the-policy-already-there.abide?source'
import Seven from './7-and-the-policy-that-needs-it.abide'
import SEVEN_CLIENT from './7-and-the-policy-that-needs-it.abide?source'
import SEVEN from './7-and-the-policy-that-needs-it.ts?source'
import Eight from './8-the-whole-cookie-jar.abide'
import EIGHT_CLIENT from './8-the-whole-cookie-jar.abide?source'
import Nine from './9-a-module-memo-per-caller.abide'
import NINE_CLIENT from './9-a-module-memo-per-caller.abide?source'
import Ten from './10-what-the-trace-carries-onward.abide'
import TEN_CLIENT from './10-what-the-trace-carries-onward.abide?source'
import Eleven from './11-ship-the-span-to-a-collector.abide'
import ELEVEN_CLIENT from './11-ship-the-span-to-a-collector.abide?source'
import ELEVEN from './11-ship-the-span-to-a-collector.ts?source'
import SIX from '#server/rpc/docs/request/the-policy-already-there.ts?source'
import EIGHT from '#server/rpc/docs/request/the-whole-cookie-jar.ts?source'
import NINE from '#server/rpc/docs/request/a-module-memo-per-caller.ts?source'
import TEN from '#server/rpc/docs/request/what-the-trace-carries-onward.ts?source'
import ONE from '#server/rpc/docs/request/the-request-being-answered.ts?source'
import TWO from '#server/rpc/docs/request/what-the-caller-sent.ts?source'
import THREE from '#server/rpc/docs/request/your-own-store.ts?source'
import FOUR from '#server/rpc/docs/request/the-thread-through-the-logs.ts?source'
import FIVE from '#server/rpc/docs/request/a-nonce-per-request.ts?source'

export const LADDER: Example[] = [
    {
        adds: 'the Request itself, as an ambient rather than a parameter',
        of: ['request'],
        source: ONE,
        client: ONE_CLIENT,
        view: One,
    },
    {
        adds: 'what the caller sent, parsed once and held',
        of: ['cookies'],
        source: TWO,
        client: TWO_CLIENT,
        view: Two,
    },
    { adds: 'your own store, one per request', of: ['bag'], source: THREE, client: THREE_CLIENT, view: Three },
    {
        adds: 'the id that ties this request’s log lines to the caller’s',
        of: ['trace'],
        source: FOUR,
        client: FOUR_CLIENT,
        view: Four,
    },
    {
        adds: 'one unguessable value per request, the same for every asker',
        of: ['nonce'],
        source: FIVE,
        client: FIVE_CLIENT,
        view: Five,
    },
    // Two rungs about the policy, and the DIFF between them is the lesson: what a page carries with
    // nothing installed, and then everything `csp()` adds on top of it.
    {
        adds: 'the policy a page already carries, with no middleware at all',
        of: ['csp'],
        source: SIX,
        client: SIX_CLIENT,
        view: Six,
    },
    {
        adds: 'and the rest of it, opt-in — the half that makes that nonce mean something',
        of: ['csp'],
        source: SEVEN,
        client: SEVEN_CLIENT,
        view: Seven,
    },
    // The last three go back over three of the ambients above and ask what ELSE is on them — the rest
    // of the jar, what the bag is really the scope FOR, and the outbound half of a trace.
    {
        adds: 'the rest of the jar — it is an ordinary `Map`, so `has` and `size` are there too',
        of: ['cookies'],
        source: EIGHT,
        client: EIGHT_CLIENT,
        view: Eight,
    },
    {
        adds: 'the same scope is what a module-level `memo` is keyed INSIDE',
        of: ['bag'],
        source: NINE,
        client: NINE_CLIENT,
        view: Nine,
    },
    {
        adds: 'what a trace carries ONWARD, and the state that propagates byte for byte',
        of: ['trace'],
        source: TEN,
        client: TEN_CLIENT,
        view: Ten,
    },
    // Last, and the only rung here that is not about READING the scope: it is what the two ids are
    // for. A MIDDLEWARE rung like rung 7, and for the same reason — the answer is the response, so
    // only something holding it can finish a span.
    {
        adds: 'and what those ids are FOR — a span shipped to a collector, from a middleware rung',
        of: ['trace', 'middleware'],
        source: ELEVEN,
        client: ELEVEN_CLIENT,
        view: Eleven,
    },
]
