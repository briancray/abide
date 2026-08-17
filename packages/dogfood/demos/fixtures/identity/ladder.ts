// The `identity` ladder. Rung 1 is one file because `identity()` is the same call on both sides; the
// two after it are two files each, and for the reason the ladder is about — the WRITERS are the
// server's, and so is the resolver. Rung 2's preview presses the refusal as well as the sign-in.
//
// Rung 3's hook is really registered, on `packages/dogfood/app.ts`, which is what lets its preview show
// a principal carrying fields the cookie never held.
import type { Example } from 'harness'
import One from './1-ask-who-this-is.abide'
import ONE from './1-ask-who-this-is.abide?source'
import Two from './2-the-writers-are-the-servers.abide'
import TWO_CLIENT from './2-the-writers-are-the-servers.abide?source'
import Three from './3-decide-who-the-caller-is.abide'
import THREE_CLIENT from './3-decide-who-the-caller-is.abide?source'
import THREE from './3-decide-who-the-caller-is.ts?source'
import TWO from '../../../server/rpc/docs/identity/the-writers-are-the-servers.ts?source'

export const LADDER: Example[] = [
    { adds: 'ask who this is — anonymous IS an answer, never null', of: ['identity'], source: ONE, view: One },
    {
        adds: "the two writers are the server's, and a browser calling one is told so",
        of: ['identity'],
        source: TWO,
        client: TWO_CLIENT,
        view: Two,
    },
    {
        adds: 'resolve a caller there is no cookie for — a token, a key, a session',
        of: ['onIdentity'],
        source: THREE,
        client: THREE_CLIENT,
        view: Three,
    },
]
