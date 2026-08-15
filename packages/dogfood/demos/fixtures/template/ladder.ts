// The `html` ladder — one rung per PLACE a `${}` can sit, because where it sits is what it means.
import type { Example } from 'harness'
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
import Six from './6-a-component-takes-props.abide'
import SIX from './6-a-component-takes-props.abide?source'
import { Row } from './7-the-same-tag-hand-written.ts'
import SEVEN from './7-the-same-tag-hand-written.ts?source'
import Eight from './8-trust-a-string-as-markup.abide'
import EIGHT from './8-trust-a-string-as-markup.abide?source'

export const LADDER: Example[] = [
    { adds: 'a slot in child position is CONTENT', of: ['html'], source: ONE, view: One },
    { adds: 'inside a tag it is a WHOLE attribute value, unquoted', of: ['html'], source: TWO, view: Two },
    { adds: '`class:` is a toggle, not a string', of: ['html'], source: THREE, view: Three },
    { adds: 'a branch, and its arms', of: ['html'], source: FOUR, view: Four },
    { adds: 'a list, and `by` is its key', of: ['html'], source: FIVE, view: Five },
    { adds: "that list's row as a component, which TAKES it as a prop", of: ['props'], source: SIX, view: Six },
    {
        adds: 'the same component hand-written — `html` is the tag the compiler was emitting',
        of: ['html'],
        source: SEVEN,
        view: Row,
    },
    // Placed after the hand-written tag rather than among the spellings above, because it is the rung
    // before it that makes this one mean something: `html` is the tag and it ESCAPES every slot, so the
    // hatch is a second name rather than a second way of saying the first.
    {
        adds: '`raw(…)` in a slot TRUSTS a string — the one place the escape is skipped',
        of: ['raw'],
        source: EIGHT,
        view: Eight,
    },
]
