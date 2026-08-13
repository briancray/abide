// Text only: this capability has nothing to render.
import type { Example } from 'abide-kit'
import ONE from './1-a-get-is-a-keyed-memo.ts?source'
import TWO from './2-a-declared-failure.ts?source'

export const LADDER: Example[] = [
    { adds: 'a `GET` is a keyed memo whose body is a fetch', source: ONE },
    { adds: 'a DECLARED failure, which crosses the wire as itself', source: TWO },
]
