// Text only: this capability has nothing to render.
import type { Example } from 'harness'
import ONE from './1-ask-who-this-is.ts?source'
import TWO from './2-the-writers-are-the-servers.ts?source'
import THREE from './3-decide-who-the-caller-is.ts?source'

export const LADDER: Example[] = [
    { adds: 'ask who this is — anonymous IS an answer, never null', of: ['identity'], source: ONE },
    { adds: "the two writers are the server's, and a browser calling one is told so", of: ['identity'], source: TWO },
    { adds: 'resolve a caller there is no cookie for — a token, a key, a session', of: ['onIdentity'], source: THREE },
]
