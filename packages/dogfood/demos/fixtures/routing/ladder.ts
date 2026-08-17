// The `routing` ladder. Every rung is one file, because all three names are the client's own — and the
// previews move the page they are documented on, which is the only honest way to show a move.
//
// Rung 2 is the one to press twice: it navigates to the same route with a different query, and what it
// asks you to watch is the text you typed SURVIVING, because a same-route move republishes rather than
// remounting.
import type { Example } from 'harness'
import One from './1-read-the-route.abide'
import ONE from './1-read-the-route.abide?source'
import Two from './2-move-without-a-remount.abide'
import TWO from './2-move-without-a-remount.abide?source'
import Three from './3-build-a-link.abide'
import THREE from './3-build-a-link.abide?source'

export const LADDER: Example[] = [
    { adds: 'read where you are — the PATTERN, and the segments', of: ['route'], source: ONE, view: One },
    {
        adds: 'move, and a same-route move republishes rather than remounting',
        of: ['navigate'],
        source: TWO,
        view: Two,
    },
    {
        adds: 'build the same target as an href, so a link and a move cannot disagree',
        of: ['url'],
        source: THREE,
        view: Three,
    },
]
