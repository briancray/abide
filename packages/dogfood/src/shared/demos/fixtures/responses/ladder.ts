// The `responses` ladder. A rung here IS a `Response`, so its server half is a real endpoint of this
// app and its browser half reads the ENVELOPE rather than a decoded value — `raw({ … })` reaches the
// same handler by the same address and hands the whole response back.
//
// Which is what makes these previews worth pressing: the content type, the status, the framing and the
// hop are exactly the things a decoded value throws away, and they are the whole subject of the rung.
import type { Example } from 'harness'
import One from './1-answer-with-json.abide'
import ONE_CLIENT from './1-answer-with-json.abide?source'
import Two from './2-answer-with-a-page.abide'
import TWO_CLIENT from './2-answer-with-a-page.abide?source'
import Three from './3-answer-with-a-location.abide'
import THREE_CLIENT from './3-answer-with-a-location.abide?source'
import Four from './4-refuse-with-a-status.abide'
import FOUR_CLIENT from './4-refuse-with-a-status.abide?source'
import Five from './5-answer-with-many.abide'
import FIVE_CLIENT from './5-answer-with-many.abide?source'
import Six from './6-answer-with-events.abide'
import SIX_CLIENT from './6-answer-with-events.abide?source'
import SevenA from './7-let-the-template-be-the-loop.abide'
import SEVEN_A_CLIENT from './7-let-the-template-be-the-loop.abide?source'
import Seven from './8-read-those-events.abide'
import SEVEN_CLIENT from './8-read-those-events.abide?source'
import Eight from './9-where-a-logins-cookie-goes.abide'
import EIGHT_CLIENT from './9-where-a-logins-cookie-goes.abide?source'
import Nine from './10-a-failure-with-a-shape-on-it.abide'
import NINE_CLIENT from './10-a-failure-with-a-shape-on-it.abide?source'
import ONE from '#server/rpc/docs/responses/answer-with-json.ts?source'
import TWO from '#server/rpc/docs/responses/answer-with-a-page.ts?source'
import THREE from '#server/rpc/docs/responses/answer-with-a-location.ts?source'
import FOUR from '#server/rpc/docs/responses/refuse-with-a-status.ts?source'
import FIVE from '#server/rpc/docs/responses/answer-with-many.ts?source'
import SEVEN_A from '#server/rpc/docs/responses/answer-as-they-arrive.ts?source'
import SIX from '#server/rpc/docs/responses/answer-with-events.ts?source'
import SEVEN from '#server/rpc/docs/responses/read-those-events.ts?source'
import EIGHT from '#server/rpc/docs/responses/where-a-logins-cookie-goes.ts?source'
import NINE from '#server/rpc/docs/responses/a-failure-with-a-shape-on-it.ts?source'

export const LADDER: Example[] = [
    {
        adds: 'answer with JSON, when the route builds its own Response',
        of: ['json'],
        source: ONE,
        client: ONE_CLIENT,
        view: One,
    },
    {
        adds: 'answer with HTML — and a streamed body is HELD past the handler',
        of: ['page'],
        source: TWO,
        client: TWO_CLIENT,
        view: Two,
    },
    {
        adds: 'answer with a location instead of a body',
        of: ['redirect'],
        source: THREE,
        client: THREE_CLIENT,
        view: Three,
    },
    // Two names, one idea: `error` is the throw and `HttpError` is what it throws, so a rung showing
    // one without the other would be showing half a mechanism.
    {
        adds: 'refuse with a status, THROWN so it can come from anywhere under the handler',
        of: ['error', 'HttpError'],
        source: FOUR,
        client: FOUR_CLIENT,
        view: Four,
    },
    {
        adds: 'answer with many, one line each, as they arrive',
        of: ['jsonl'],
        source: FIVE,
        client: FIVE_CLIENT,
        view: Five,
    },
    // The framing is the SERVER's whole half of this pair. Read the two clients side by side: they
    // differ in one import, because the stub asks the response what it is rather than being told —
    // so what a route picks is a question about who else has to read the address.
    {
        adds: 'frame that same source as events — and the caller does not change',
        of: ['sse'],
        source: SIX,
        client: SIX_CLIENT,
        view: Six,
    },
    // The shorter spelling of the two rungs above, and the one this ladder had nowhere: `{#for await}`
    // is a block head, so the loop stops being something the client WRITES. On `jsonl` because that
    // page had one rung to `sse`'s two, and the block reads either framing — the head names the call.
    {
        adds: 'let the TEMPLATE be the loop, so nothing collects the rows',
        of: ['jsonl'],
        source: SEVEN_A,
        client: SEVEN_A_CLIENT,
        view: SevenA,
    },
    // The same endpoint read by something that is not a stub, which is the half the sse rung above
    // cannot show: a caller reading its own app would be as happy with `jsonl`, so what `sse` is FOR
    // only appears when the reader is somebody else's.
    {
        adds: 'read that stream with the browser’s own client, which needs an ADDRESS',
        of: ['sse'],
        source: SEVEN,
        client: SEVEN_CLIENT,
        view: Seven,
    },
    // The last two are the same six helpers again, asked what happens at the edges: what else rides on
    // the response, and what a refusal can CARRY.
    //
    // A THIRD is written and not here — `11-when-a-stream-fails-mid-body.ts`, on what is left to say once
    // the status line is out. Wiring it means moving it under `server/rpc/**`, and a source that throws
    // part way through a `jsonl` body reaches `process.on('unhandledRejection')` in `lifecycle.ts` and
    // takes the server down with it, so an addressable one is a page whose button ends the process.
    {
        adds: 'the third argument, where the caller’s own headers ride',
        of: ['redirect'],
        source: EIGHT,
        client: EIGHT_CLIENT,
        view: Eight,
    },
    {
        adds: 'a DECLARED refusal, returned rather than thrown, so it carries data a caller can read',
        of: ['error'],
        source: NINE,
        client: NINE_CLIENT,
        view: Nine,
    },
]
