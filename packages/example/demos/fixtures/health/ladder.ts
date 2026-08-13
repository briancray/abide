// Text only: this capability has nothing to render.
import type { Example } from 'abide-kit'
import ONE from './1-ask-about-this-process.ts?source'
import TWO from './2-add-the-apps-own-fields.ts?source'

export const LADDER: Example[] = [
    { adds: 'ask, and get a floor abide filled in', source: ONE },
    { adds: "merge the app's own fields OVER that floor", source: TWO },
]
