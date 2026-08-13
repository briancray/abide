// Text only: what this documents is a PAIR of lanes, and a page can only be in one of them.
import type { Example } from 'abide-kit'
import ONE from './1-render-hydratable.ts?source'
import TWO from './2-adopt-it-on-the-client.ts?source'

export const LADDER: Example[] = [
    { adds: 'render with markers, so there is something to adopt', source: ONE },
    { adds: 'adopt it — the first update writes nothing, because every binding compares', source: TWO },
]
