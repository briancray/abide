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
import Seven from './7-where-a-logins-cookie-goes.abide'
import SEVEN_CLIENT from './7-where-a-logins-cookie-goes.abide?source'
import Eight from './8-a-failure-with-a-shape-on-it.abide'
import EIGHT_CLIENT from './8-a-failure-with-a-shape-on-it.abide?source'
import ONE from '../../../server/rpc/docs/responses/answer-with-json.ts?source'
import TWO from '../../../server/rpc/docs/responses/answer-with-a-page.ts?source'
import THREE from '../../../server/rpc/docs/responses/answer-with-a-location.ts?source'
import FOUR from '../../../server/rpc/docs/responses/refuse-with-a-status.ts?source'
import FIVE from '../../../server/rpc/docs/responses/answer-with-many.ts?source'
import SIX from '../../../server/rpc/docs/responses/answer-with-events.ts?source'
import SEVEN from '../../../server/rpc/docs/responses/where-a-logins-cookie-goes.ts?source'
import EIGHT from '../../../server/rpc/docs/responses/a-failure-with-a-shape-on-it.ts?source'

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
    {
        adds: 'frame that same source as events, for an EventSource to read',
        of: ['sse'],
        source: SIX,
        client: SIX_CLIENT,
        view: Six,
    },
    // The last two are the same six helpers again, asked what happens at the edges: what else rides on
    // the response, and what a refusal can CARRY.
    //
    // A THIRD is written and not here — `9-when-a-stream-fails-mid-body.ts`, on what is left to say once
    // the status line is out. Wiring it means moving it under `server/rpc/**`, and a source that throws
    // part way through a `jsonl` body reaches `process.on('unhandledRejection')` in `lifecycle.ts` and
    // takes the server down with it, so an addressable one is a page whose button ends the process.
    {
        adds: 'the third argument, where the caller’s own headers ride',
        of: ['redirect'],
        source: SEVEN,
        client: SEVEN_CLIENT,
        view: Seven,
    },
    {
        adds: 'a DECLARED refusal, returned rather than thrown, so it carries data a caller can read',
        of: ['error'],
        source: EIGHT,
        client: EIGHT_CLIENT,
        view: Eight,
    },
]
