// Text only: an example that navigated would move the page it is documented on.
import type { Example } from 'abide-kit'
import ONE from './1-read-the-route.ts?source'
import TWO from './2-move-without-a-remount.ts?source'

export const LADDER: Example[] = [
    { adds: 'read where you are — the PATTERN, and the segments', source: ONE },
    { adds: 'move, and a same-route move republishes rather than remounting', source: TWO },
]
