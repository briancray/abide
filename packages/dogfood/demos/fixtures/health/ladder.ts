// Text only: this capability has nothing to render.
import type { Example } from 'harness'
import ONE from './1-ask-about-this-process.ts?source'
import TWO from './2-add-the-apps-own-fields.ts?source'
import THREE from './3-and-whether-the-network-is-there.ts?source'

export const LADDER: Example[] = [
    { adds: 'ask, and get a floor abide filled in', of: ['health'], source: ONE },
    { adds: "merge the app's own fields OVER that floor", of: ['onHealth'], source: TWO },
    {
        adds: 'and whether the network is there at all, which changes with no caller arriving',
        of: ['online'],
        source: THREE,
    },
]
