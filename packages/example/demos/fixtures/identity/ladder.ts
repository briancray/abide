// Text only: this capability has nothing to render.
import type { Example } from 'abide-kit'
import ONE from './1-ask-who-this-is.ts?source'
import TWO from './2-the-writers-are-the-servers.ts?source'

export const LADDER: Example[] = [
    { adds: 'ask who this is — anonymous IS an answer, never null', source: ONE },
    { adds: "the two writers are the server's, and a browser calling one is told so", source: TWO },
]
