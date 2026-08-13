// The `server` ladder. The second rung is the one that needs a streaming renderer at all.
import type { Example } from 'abide-kit'
import One from './1-render-a-component.abide'
import ONE from './1-render-a-component.abide?source'
import Two from './2-suspend-and-stream.abide'
import TWO from './2-suspend-and-stream.abide?source'

export const LADDER: Example[] = [
    { adds: 'render a component — one walk, in document order', source: ONE, view: One },
    { adds: 'a region that SUSPENDS: the shell goes out, the rest follows', source: TWO, view: Two },
]
