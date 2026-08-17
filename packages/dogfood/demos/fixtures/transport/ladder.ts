// The `transport` ladder — the first one where a rung is TWO files.
//
// Every rung here declares something a browser never receives, so the declaration alone documents a
// call whose spelling the reader is left to guess. The `server` half is therefore a REAL endpoint of
// this app rather than a fixture shaped like one: it sits under `server/rpc/**`, which is what makes
// it addressable, what elides it out of the browser lane, and what the `client` half beside it calls
// for real when somebody presses the button in the preview.
//
// Rung 7's server half is `server/sockets/feed.ts` itself. It was a fixture copy of that file, down to
// the comments — two declarations of one idea, and the copy was the one with nothing behind it.
import type { Example } from 'harness'
import One from './1-a-get-is-a-keyed-memo.abide'
import ONE_CLIENT from './1-a-get-is-a-keyed-memo.abide?source'
import Two from './2-a-declared-failure.abide'
import TWO_CLIENT from './2-a-declared-failure.abide?source'
import Three from './3-a-mutation.abide'
import THREE_CLIENT from './3-a-mutation.abide?source'
import Four from './4-a-full-replacement.abide'
import FOUR_CLIENT from './4-a-full-replacement.abide?source'
import Five from './5-a-partial-amendment.abide'
import FIVE_CLIENT from './5-a-partial-amendment.abide?source'
import Six from './6-a-removal.abide'
import SIX_CLIENT from './6-a-removal.abide?source'
import Seven from './7-subscribe-over-the-wire.abide'
import SEVEN_CLIENT from './7-subscribe-over-the-wire.abide?source'
import Eight from './8-describe-it-and-declare-its-shape.abide'
import EIGHT_CLIENT from './8-describe-it-and-declare-its-shape.abide?source'
import Nine from './9-authorize-every-read.abide'
import NINE_CLIENT from './9-authorize-every-read.abide?source'
import Ten from './10-what-a-call-retains.abide'
import TEN_CLIENT from './10-what-a-call-retains.abide?source'
import Eleven from './11-the-three-limits.abide'
import ELEVEN_CLIENT from './11-the-three-limits.abide?source'
import Twelve from './12-the-answer-travels-with-the-markup.abide'
import TWELVE_CLIENT from './12-the-answer-travels-with-the-markup.abide?source'
import Thirteen from './13-a-handler-that-yields.abide'
import THIRTEEN_CLIENT from './13-a-handler-that-yields.abide?source'
import Fourteen from './14-a-file-is-an-argument.abide'
import FOURTEEN_CLIENT from './14-a-file-is-an-argument.abide?source'
import Fifteen from './15-the-raw-response.abide'
import FIFTEEN from './15-the-raw-response.abide?source'
import SEVEN from '../../../server/sockets/feed.ts?source'
import ONE from '../../../server/rpc/docs/transport/a-get-is-a-keyed-memo.ts?source'
import TWO from '../../../server/rpc/docs/transport/a-declared-failure.ts?source'
import THREE from '../../../server/rpc/docs/transport/a-mutation.ts?source'
import FOUR from '../../../server/rpc/docs/transport/a-full-replacement.ts?source'
import FIVE from '../../../server/rpc/docs/transport/a-partial-amendment.ts?source'
import SIX from '../../../server/rpc/docs/transport/a-removal.ts?source'
import EIGHT from '../../../server/rpc/docs/transport/describe-it-and-declare-its-shape.ts?source'
import NINE from '../../../server/rpc/docs/transport/authorize-every-read.ts?source'
import TEN from '../../../server/rpc/docs/transport/what-a-call-retains.ts?source'
import ELEVEN from '../../../server/rpc/docs/transport/the-three-limits.ts?source'
import TWELVE from '../../../server/rpc/docs/transport/the-answer-travels-with-the-markup.ts?source'
import THIRTEEN from '../../../server/rpc/docs/transport/a-handler-that-yields.ts?source'
import FOURTEEN from '../../../server/rpc/docs/transport/a-file-is-an-argument.ts?source'

export const LADDER: Example[] = [
    {
        adds: 'a `GET` is a keyed memo whose body is a fetch',
        of: ['GET'],
        source: ONE,
        client: ONE_CLIENT,
        view: One,
    },
    {
        adds: 'a DECLARED failure, which crosses the wire as itself',
        of: ['error'],
        source: TWO,
        client: TWO_CLIENT,
        view: Two,
    },
    {
        adds: 'a mutation, which retains nothing — the same declaration, a different verb',
        of: ['POST'],
        source: THREE,
        client: THREE_CLIENT,
        view: Three,
    },
    // One rung per method, because `/docs/PUT`, `/docs/PATCH` and `/docs/DELETE` are three pages and a
    // rung claiming all three shows a reader two verbs they did not look up. The declaration is the
    // same one three times over — what differs is what the ARGUMENT is allowed to say, which is the
    // only thing left for three rungs to be about.
    {
        adds: '`PUT` — the same mutation with the method changed, replacing every field',
        of: ['PUT'],
        source: FOUR,
        client: FOUR_CLIENT,
        view: Four,
    },
    {
        adds: '`PATCH` — the same again, and what the argument omits it leaves alone',
        of: ['PATCH'],
        source: FIVE,
        client: FIVE_CLIENT,
        view: Five,
    },
    {
        adds: '`DELETE` — the key alone, and a method no link can reach',
        of: ['DELETE'],
        source: SIX,
        client: SIX_CLIENT,
        view: Six,
    },
    {
        adds: 'the other law — a `channel` whose subscribers arrived over a wire',
        of: ['socket'],
        source: SEVEN,
        client: SEVEN_CLIENT,
        view: Seven,
    },
    // Rungs 1-7 are the seven DECLARATIONS. What is left is the second argument — the options record —
    // one concern at a time, because a rung showing `schemas`, `middleware`, `memo`, the three limits
    // and `seed` together would be a large example of none of them.
    {
        adds: 'the second argument — a description, and a shape declared instead of derived',
        of: ['GET'],
        source: EIGHT,
        client: EIGHT_CLIENT,
        view: Eight,
    },
    {
        adds: 'a chain over ONE endpoint, which is where authorization belongs',
        of: ['middleware'],
        source: NINE,
        client: NINE_CLIENT,
        view: Nine,
    },
    {
        adds: 'the `memo` half spelled out — the same options a local keyed memo takes',
        of: ['GET'],
        source: TEN,
        client: TEN_CLIENT,
        view: Ten,
    },
    {
        adds: 'the three limits, each CLOSED until the declaration opens it',
        of: ['POST'],
        source: ELEVEN,
        client: ELEVEN_CLIENT,
        view: Eleven,
    },
    {
        adds: 'whether the answer travels with the markup, and when it should not',
        of: ['GET'],
        source: TWELVE,
        client: TWELVE_CLIENT,
        view: Twelve,
    },
    {
        adds: 'a handler that YIELDS, read off the syntax rather than out of a flag',
        of: ['GET'],
        source: THIRTEEN,
        client: THIRTEEN_CLIENT,
        view: Thirteen,
    },
    {
        adds: 'a file is an ARGUMENT, not a second calling convention',
        of: ['POST'],
        source: FOURTEEN,
        client: FOURTEEN_CLIENT,
        view: Fourteen,
    },
    // One file: every line of it is the browser's, and the declaration it reads is rung 1's. A second
    // pane would be that rung's server half shown twice under a label claiming a seam this does cross
    // but does not DECLARE.
    {
        adds: 'the raw response, for when the envelope is the point',
        of: ['GET'],
        source: FIFTEEN,
        view: Fifteen,
    },
]
