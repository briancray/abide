// The `logging` ladder. One file per rung: `log` is the same call on both sides, so a preview writes
// real lines — to the browser's console, which is where a client's go.
//
// What the page can show that the console cannot is the GATE: `enabled()` is the framework's own
// answer, and rung 3's counter is the allocation the gate saved, which is invisible in the output by
// construction.
import type { Example } from 'harness'
import One from './1-the-apps-own-channel.abide'
import ONE from './1-the-apps-own-channel.abide?source'
import Two from './2-a-named-channel.abide'
import TWO from './2-a-named-channel.abide?source'
import Three from './3-when-the-message-is-the-cost.abide'
import THREE from './3-when-the-message-is-the-cost.abide?source'

export const LADDER: Example[] = [
    {
        adds: "the app's own channel always writes — and so do `warning` and `error`",
        of: ['log'],
        source: ONE,
        view: One,
    },
    { adds: 'a named channel, off until `DEBUG` names it', of: ['log'], source: TWO, view: Two },
    {
        adds: '`enabled()`, for when building the message is the cost',
        of: ['log'],
        source: THREE,
        view: Three,
    },
]
