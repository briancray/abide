// Text only: what this documents is a PAIR of lanes, and a page can only be in one of them.
import type { Example } from 'harness'
import ONE from './1-render-hydratable.ts?source'
import TWO from './2-adopt-it-on-the-client.ts?source'

// `of` is EMPTY on both, for the reason `client`'s are: `hydrate` is called by the GENERATED client
// entry and by nothing an author writes, so there is no `/docs/<name>` for these to appear on.
export const LADDER: Example[] = [
    { adds: 'render with markers, so there is something to adopt', of: [], source: ONE },
    {
        adds: 'adopt it — the first update writes nothing, because every binding compares',
        of: [],
        source: TWO,
    },
]
