// The `health` ladder. One file per rung and no server half on two of the three, which is the point
// being made rather than a gap: `health()` and `online()` are the SAME CALL on both sides, so what a
// page writes to ask about a process is what the process writes to answer.
//
// Rung 2 is the exception and is two files, because a reporter is something only a server has. The one
// it shows is real — `packages/dogfood/app.ts` exports it — so the `example` field the preview reads
// back is that hook's, merged over abide's floor.
import type { Example } from 'harness'
import One from './1-ask-about-this-process.abide'
import ONE from './1-ask-about-this-process.abide?source'
import Two from './2-add-the-apps-own-fields.abide'
import TWO_CLIENT from './2-add-the-apps-own-fields.abide?source'
import TWO from './2-add-the-apps-own-fields.ts?source'
import Three from './3-and-whether-the-network-is-there.abide'
import THREE from './3-and-whether-the-network-is-there.abide?source'

export const LADDER: Example[] = [
    { adds: 'ask, and get a floor abide filled in', of: ['health'], source: ONE, view: One },
    {
        adds: "merge the app's own fields OVER that floor",
        of: ['onHealth'],
        source: TWO,
        client: TWO_CLIENT,
        view: Two,
    },
    {
        adds: 'and whether the network is there at all, which changes with no caller arriving',
        of: ['online'],
        source: THREE,
        view: Three,
    },
]
