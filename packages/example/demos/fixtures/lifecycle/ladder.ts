// Text only: this capability has nothing to render.
import type { Example } from 'abide-kit'
import ONE from './1-boot-is-an-onion.ts?source'
import TWO from './2-wrap-every-request.ts?source'

export const LADDER: Example[] = [
    { adds: 'boot is an ONION, so the socket binds INSIDE it', source: ONE },
    { adds: 'wrap every request, outermost first', source: TWO },
]
