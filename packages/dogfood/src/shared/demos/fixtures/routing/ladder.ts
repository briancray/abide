// The `routing` ladder. Every rung is one file, because all three names are the client's own — and the
// previews move the page they are documented on, which is the only honest way to show a move.
//
// The order is the three names in the order an app meets them: where you ARE (1-2), the href you build
// from it (3-8), and the move that takes it (9-10). `url` gets six because it is six shapes on one
// signature — a pattern, its two irregular segment kinds, a query, a relative target, another origin —
// and a rung showing them together would be a large example of none of them.
//
// Rungs 1, 2 and 6 read where the caller is, and each is therefore behind a BUTTON: `route()` refuses
// where there is neither a request being served nor a document, and a relative target resolved in that
// substrate answers about nowhere. `#shared/demos/proofs.ts` renders every view in exactly that substrate.
//
// Rung 9 is the one to press twice: it navigates to the same route with a different query, and what it
// asks you to watch is the text you typed SURVIVING, because a same-route move republishes rather than
// remounting.
import type { Example } from 'harness'
import One from './1-read-the-route.abide'
import ONE from './1-read-the-route.abide?source'
import Two from './2-the-rest-of-the-route.abide'
import TWO from './2-the-rest-of-the-route.abide?source'
import Three from './3-build-a-link.abide'
import THREE from './3-build-a-link.abide?source'
import Four from './4-optional-and-rest-segments.abide'
import FOUR from './4-optional-and-rest-segments.abide?source'
import Five from './5-add-a-query.abide'
import FIVE from './5-add-a-query.abide?source'
import Six from './6-relative-to-where-you-are.abide'
import SIX from './6-relative-to-where-you-are.abide?source'
import Seven from './7-another-origin.abide'
import SEVEN from './7-another-origin.abide?source'
import Eight from './8-the-two-refusals.abide'
import EIGHT from './8-the-two-refusals.abide?source'
import Nine from './9-move-without-a-remount.abide'
import NINE from './9-move-without-a-remount.abide?source'
import Ten from './10-replace-and-keep-the-scroll.abide'
import TEN from './10-replace-and-keep-the-scroll.abide?source'

export const LADDER: Example[] = [
    { adds: 'read where you are — the PATTERN, and the segments', of: ['route'], source: ONE, view: One },
    {
        adds: 'the other two reads, and why they are separate states rather than one record',
        of: ['route'],
        source: TWO,
        view: Two,
    },
    {
        adds: 'build the same target as an href, so a link and a move cannot disagree',
        of: ['url'],
        source: THREE,
        view: Three,
    },
    {
        adds: 'the two segment kinds that are not simply required — optional, and the rest',
        of: ['url'],
        source: FOUR,
        view: Four,
    },
    {
        adds: 'a query as the third argument, which MERGES with one the target already carried',
        of: ['url'],
        source: FIVE,
        view: Five,
    },
    {
        adds: 'a relative target, which is the one shape that reads where the caller is',
        of: ['url'],
        source: SIX,
        view: Six,
    },
    {
        adds: 'another origin, and the three shapes that are not this app’s path space',
        of: ['url'],
        source: SEVEN,
        view: Seven,
    },
    {
        adds: 'the two refusals — both thrown at the call rather than 404ing later',
        of: ['url'],
        source: EIGHT,
        view: Eight,
    },
    {
        adds: 'move, and a same-route move republishes rather than remounting',
        of: ['navigate'],
        source: NINE,
        view: Nine,
    },
    {
        adds: 'the two options a move takes, and both are about the history entry',
        of: ['navigate'],
        source: TEN,
        view: Ten,
    },
]
