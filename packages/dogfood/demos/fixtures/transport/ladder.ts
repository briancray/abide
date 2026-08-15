// Text only: this capability has nothing to render.
import type { Example } from 'harness'
import ONE from './1-a-get-is-a-keyed-memo.ts?source'
import TWO from './2-a-declared-failure.ts?source'
import THREE from './3-a-mutation.ts?source'
import FOUR from './4-the-other-three-verbs.ts?source'
import FIVE from './5-subscribe-over-the-wire.ts?source'

export const LADDER: Example[] = [
    { adds: 'a `GET` is a keyed memo whose body is a fetch', of: ['GET'], source: ONE },
    { adds: 'a DECLARED failure, which crosses the wire as itself', of: ['error'], source: TWO },
    {
        adds: 'a mutation, which retains nothing — the same declaration, a different verb',
        of: ['POST'],
        source: THREE,
    },
    // Three names, one rung, because the method string is the only difference between them — three
    // near-identical files would be three examples of nothing.
    {
        adds: 'and the other three verbs, which are that one with the method changed',
        of: ['PUT', 'PATCH', 'DELETE'],
        source: FOUR,
    },
    { adds: 'the other law — a `channel` whose subscribers arrived over a wire', of: ['socket'], source: FIVE },
]
