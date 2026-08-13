// The `html` ladder — one rung per PLACE a `${}` can sit, because where it sits is what it means.
import type { Example } from 'abide-kit'
import One from './1-content.abide'
import ONE from './1-content.abide?source'
import Two from './2-an-attribute.abide'
import TWO from './2-an-attribute.abide?source'
import Three from './3-a-class-toggle.abide'
import THREE from './3-a-class-toggle.abide?source'
import Four from './4-a-branch.abide'
import FOUR from './4-a-branch.abide?source'
import Five from './5-a-list.abide'
import FIVE from './5-a-list.abide?source'

export const LADDER: Example[] = [
    { adds: 'a slot in child position is CONTENT', source: ONE, view: One },
    { adds: 'inside a tag it is a WHOLE attribute value, unquoted', source: TWO, view: Two },
    { adds: '`class:` is a toggle, not a string', source: THREE, view: Three },
    { adds: 'a branch, and its arms', source: FOUR, view: Four },
    { adds: 'a list, and `by` is its key', source: FIVE, view: Five },
]
