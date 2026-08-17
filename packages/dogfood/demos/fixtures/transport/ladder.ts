// The `transport` ladder — the first one where a rung is TWO files.
//
// Every rung here declares something a browser never receives, so the declaration alone documents a
// call whose spelling the reader is left to guess. The `server` half is therefore a REAL endpoint of
// this app rather than a fixture shaped like one: it sits under `server/rpc/**`, which is what makes
// it addressable, what elides it out of the browser lane, and what the `client` half beside it calls
// for real when somebody presses the button in the preview.
//
// Rung 5's server half is `server/sockets/feed.ts` itself. It was a fixture copy of that file, down to
// the comments — two declarations of one idea, and the copy was the one with nothing behind it.
import type { Example } from 'harness'
import One from './1-a-get-is-a-keyed-memo.abide'
import ONE_CLIENT from './1-a-get-is-a-keyed-memo.abide?source'
import Two from './2-a-declared-failure.abide'
import TWO_CLIENT from './2-a-declared-failure.abide?source'
import Three from './3-a-mutation.abide'
import THREE_CLIENT from './3-a-mutation.abide?source'
import Four from './4-the-other-three-verbs.abide'
import FOUR_CLIENT from './4-the-other-three-verbs.abide?source'
import Five from './5-subscribe-over-the-wire.abide'
import FIVE_CLIENT from './5-subscribe-over-the-wire.abide?source'
import FIVE from '../../../server/sockets/feed.ts?source'
import ONE from '../../../server/rpc/docs/transport/a-get-is-a-keyed-memo.ts?source'
import TWO from '../../../server/rpc/docs/transport/a-declared-failure.ts?source'
import THREE from '../../../server/rpc/docs/transport/a-mutation.ts?source'
import FOUR from '../../../server/rpc/docs/transport/the-other-three-verbs.ts?source'

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
    // Three names, one rung, because the method string is the only difference between them — three
    // near-identical files would be three examples of nothing.
    {
        adds: 'and the other three verbs, which are that one with the method changed',
        of: ['PUT', 'PATCH', 'DELETE'],
        source: FOUR,
        client: FOUR_CLIENT,
        view: Four,
    },
    {
        adds: 'the other law — a `channel` whose subscribers arrived over a wire',
        of: ['socket'],
        source: FIVE,
        client: FIVE_CLIENT,
        view: Five,
    },
]
