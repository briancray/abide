// Text only: an example that navigated would move the page it is documented on.
import type { Example } from 'harness'
import ONE from './1-read-the-route.ts?source'
import TWO from './2-move-without-a-remount.ts?source'
import THREE from './3-build-a-link.ts?source'

export const LADDER: Example[] = [
    { adds: 'read where you are — the PATTERN, and the segments', of: ['route'], source: ONE },
    { adds: 'move, and a same-route move republishes rather than remounting', of: ['navigate'], source: TWO },
    { adds: 'build the same target as an href, so a link and a move cannot disagree', of: ['url'], source: THREE },
]
