// The `channel` ladder. Each rung is the one above it plus the one thing `adds` names.
//
// Three groups. Rungs 1-2 are the stream and what it remembers; 3-5 are the three ways to CONSUME one
// — keyed rooms, a listener outside the graph, and the replay-then-follow that closes the gap between
// the other two; 6-7 are the two ways a message stops being current, one by the clock and one by hand.
import type { Example } from 'harness'
import One from './1-publish-and-read.abide'
import ONE from './1-publish-and-read.abide?source'
import Two from './2-remember-the-last-few.abide'
import TWO from './2-remember-the-last-few.abide?source'
import Three from './3-split-it-into-rooms.abide'
import THREE from './3-split-it-into-rooms.abide?source'
import Four from './4-a-listener-outside-the-graph.abide'
import FOUR from './4-a-listener-outside-the-graph.abide?source'
import Five from './5-replay-then-follow.abide'
import FIVE from './5-replay-then-follow.abide?source'
import Six from './6-how-long-a-message-is-current.abide'
import SIX from './6-how-long-a-message-is-current.abide?source'
import Seven from './7-forget-what-arrived.abide'
import SEVEN from './7-forget-what-arrived.abide?source'

export const LADDER: Example[] = [
    {
        adds: 'publish, and read the latest — the read IS the subscription',
        of: ['channel'],
        source: ONE,
        view: One,
    },
    { adds: 'remember the last few, with `tail`', of: ['channel'], source: TWO, view: Two },
    {
        adds: 'a second type parameter splits it into KEYED rooms',
        of: ['channel'],
        source: THREE,
        view: Three,
    },
    {
        adds: 'a plain listener outside the graph, which hands back its own unsubscribe',
        of: ['channel'],
        source: FOUR,
        view: Four,
    },
    {
        adds: 'replay then follow, with the snapshot and the subscribe in one run',
        of: ['channel'],
        source: FIVE,
        view: Five,
    },
    {
        adds: 'how long a message counts as current — and expiry WAKES its readers',
        of: ['channel'],
        source: SIX,
        view: Six,
    },
    { adds: 'forget what arrived, without closing anything', of: ['channel'], source: SEVEN, view: Seven },
]
