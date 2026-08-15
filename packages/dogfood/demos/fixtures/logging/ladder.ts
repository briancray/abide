// Text only: this capability has nothing to render.
import type { Example } from 'harness'
import ONE from './1-the-apps-own-channel.ts?source'
import TWO from './2-a-named-channel.ts?source'
import THREE from './3-when-the-message-is-the-cost.ts?source'

export const LADDER: Example[] = [
    { adds: "the app's own channel always writes — and so do `warning` and `error`", of: ['log'], source: ONE },
    { adds: 'a named channel, off until `DEBUG` names it', of: ['log'], source: TWO },
    { adds: '`enabled()`, for when building the message is the cost', of: ['log'], source: THREE },
]
