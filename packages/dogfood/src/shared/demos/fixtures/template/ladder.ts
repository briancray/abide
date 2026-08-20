// The template ladder — one rung per PLACE a slot can sit and per BLOCK it can sit in, because where
// something sits is what it means.
//
// The longest ladder in the repo, and it is one ladder rather than fifteen because the rungs GROW:
// `bind:checked` is `bind:value` plus a boolean, and `by` is a list plus a key. `/docs/syntax/<slug>`
// slices it by `spells` — a slice of a growing sequence is still in order — so a reader who arrived
// with `{#for}` gets four rungs and not thirty-four.
//
// TWO CLAIMS PER RUNG, and most of these make only the second. `of` is a name an author IMPORTS and
// `spells` is how something is TYPED in a file, and the template is nearly all of the second kind:
// `{#if}`, `bind:value` and `<slot/>` import nothing. The three rungs claiming a name claim `props`
// and `raw`, which an author does write. The tag itself is `html`, which the compiler emits into every
// `.abide` file rather than anybody typing — see `CALLABLES.ts`.

import type { Example } from 'harness'
import Content from './01-content.abide'
import CONTENT from './01-content.abide?source'
import Attribute from './02-an-attribute.abide'
import ATTRIBUTE from './02-an-attribute.abide?source'
import Quoted from './03-a-quoted-value.abide'
import QUOTED from './03-a-quoted-value.abide?source'
import Listener from './04-a-listener.abide'
import LISTENER from './04-a-listener.abide?source'
import BindValue from './05-bind-a-value.abide'
import BIND_VALUE from './05-bind-a-value.abide?source'
import BindChecked from './06-bind-a-checkbox.abide'
import BIND_CHECKED from './06-bind-a-checkbox.abide?source'
import BindGroup from './07-bind-a-group.abide'
import BIND_GROUP from './07-bind-a-group.abide?source'
import BindRadioGroup from './08-bind-a-group-of-radios.abide'
import BIND_RADIO_GROUP from './08-bind-a-group-of-radios.abide?source'
import BindOpen from './09-bind-a-disclosure.abide'
import BIND_OPEN from './09-bind-a-disclosure.abide?source'
import BindElement from './10-bind-the-element.abide'
import BIND_ELEMENT from './10-bind-the-element.abide?source'
import RefHandler from './11-a-handler-instead-of-a-state.abide'
import REF_HANDLER from './11-a-handler-instead-of-a-state.abide?source'
import BindAccessors from './12-bind-an-accessor-pair.abide'
import BIND_ACCESSORS from './12-bind-an-accessor-pair.abide?source'
import ClassToggle from './13-a-class-toggle.abide'
import CLASS_TOGGLE from './13-a-class-toggle.abide?source'
import StyleProperty from './14-a-style-property.abide'
import STYLE_PROPERTY from './14-a-style-property.abide?source'
import Spread from './15-spread-the-rest.abide'
import SPREAD from './15-spread-the-rest.abide?source'
import Awaited from './16-await-in-a-slot.abide'
import AWAITED from './16-await-in-a-slot.abide?source'
import Trusted from './17-trust-a-string-as-markup.abide'
import TRUSTED from './17-trust-a-string-as-markup.abide?source'
import Branch from './18-a-branch.abide'
import BRANCH from './18-a-branch.abide?source'
import MoreArms from './19-more-arms.abide'
import MORE_ARMS from './19-more-arms.abide?source'
import FailureArm from './20-a-failure-needs-an-arm.abide'
import FAILURE_ARM from './20-a-failure-needs-an-arm.abide?source'
import List from './21-a-list.abide'
import LIST from './21-a-list.abide?source'
import Keyed from './22-key-the-rows.abide'
import KEYED from './22-key-the-rows.abide?source'
import Indexed from './23-the-index.abide'
import INDEXED from './23-the-index.abide?source'
import Streamed from './24-rows-as-they-arrive.abide'
import STREAMED from './24-rows-as-they-arrive.abide?source'
import Switched from './25-one-expression-many-arms.abide'
import SWITCHED from './25-one-expression-many-arms.abide?source'
import Boundary from './26-an-error-boundary.abide'
import BOUNDARY from './26-an-error-boundary.abide?source'
import RowComponent from './27-a-component-takes-props.abide'
import ROW_COMPONENT from './27-a-component-takes-props.abide?source'
import Children from './28-children-arrive-in-a-slot.abide'
import CHILDREN from './28-children-arrive-in-a-slot.abide?source'
import Inline from './29-an-inline-component.abide'
import INLINE from './29-an-inline-component.abide?source'
import { Row } from './30-the-same-tag-hand-written.ts'
import HAND_WRITTEN from './30-the-same-tag-hand-written.ts?source'
import Chosen from './31-a-state-chooses-the-component.abide'
import CHOSEN from './31-a-state-chooses-the-component.abide?source'
import TwoScopes from './32-two-scopes-in-one-file.abide'
import TWO_SCOPES from './32-two-scopes-in-one-file.abide?source'
import NestedScript from './33-a-nested-script-is-per-row.abide'
import NESTED_SCRIPT from './33-a-nested-script-is-per-row.abide?source'
import ScopedStyles from './34-scoped-styles.abide'
import SCOPED_STYLES from './34-scoped-styles.abide?source'
import NestedStyle from './35-a-nested-style-scopes-a-subtree.abide'
import NESTED_STYLE from './35-a-nested-style-scopes-a-subtree.abide?source'
import WRITTEN_BACK from './36-a-prop-the-child-writes-back.abide?source'
import WrittenBack from './36-a-prop-the-child-writes-back.parent.abide'
import WRITTEN_BACK_PARENT from './36-a-prop-the-child-writes-back.parent.abide?source'
import Callback from './37-a-callback-prop-is-called.abide'
import CALLBACK from './37-a-callback-prop-is-called.abide?source'

export const LADDER: Example[] = [
    // --- the hole, and what each position does with it ---------------------------
    {
        adds: 'a slot in child position is CONTENT',
        of: [],
        spells: ['expression'],
        source: CONTENT,
        view: Content,
    },
    {
        adds: 'inside a tag it is a WHOLE attribute value, unquoted',
        of: [],
        spells: ['expression'],
        source: ATTRIBUTE,
        view: Attribute,
    },
    {
        adds: 'a QUOTED attribute interpolates, so what lands is always a string',
        of: [],
        spells: ['expression'],
        source: QUOTED,
        view: Quoted,
    },
    {
        adds: 'a native listener, whose hole is the FUNCTION and not a string',
        of: [],
        spells: ['events'],
        source: LISTENER,
        view: Listener,
    },

    // --- the directives that decorate a tag ---------------------------------------
    // The binds run together HERE and split into five pages there, which is the ladder and the index
    // doing their own jobs: as a sequence each is the one before it plus what its target does
    // differently — a boolean, a membership, a node ref — and as an address each is what a reader
    // arrived holding. `bind:checked` is not a variation on `bind:value` to somebody looking it up.
    {
        adds: 'a bind is a read AND a write: the property from the state, the state from the event',
        of: [],
        spells: ['bind-value'],
        source: BIND_VALUE,
        view: BindValue,
    },
    {
        adds: 'a BOOLEAN target, so false is the attribute being absent rather than the string',
        of: [],
        spells: ['bind-checked'],
        source: BIND_CHECKED,
        view: BindChecked,
    },
    {
        adds: 'membership rather than a value, compared against each input’s own `value`',
        of: [],
        spells: ['bind-group'],
        source: BIND_GROUP,
        view: BindGroup,
    },
    {
        adds: 'the same spelling on RADIOS, where the state is the one value rather than a list',
        of: [],
        spells: ['bind-group'],
        source: BIND_RADIO_GROUP,
        view: BindRadioGroup,
    },
    {
        adds: 'the same boolean rule on a `<details>`, written back from `toggle`',
        of: [],
        spells: ['bind-open'],
        source: BIND_OPEN,
        view: BindOpen,
    },
    {
        adds: 'a NODE ref rather than a value — the one target with no row in the table',
        of: [],
        spells: ['bind-element'],
        source: BIND_ELEMENT,
        view: BindElement,
    },
    {
        adds: 'the same bind handed a FUNCTION, called with the node and returning its teardown',
        of: [],
        spells: ['bind-element'],
        source: REF_HANDLER,
        view: RefHandler,
    },
    {
        adds: 'an explicit `{get, set}` pair, for when the two directions are not one value',
        of: [],
        spells: ['bind-value'],
        source: BIND_ACCESSORS,
        view: BindAccessors,
    },
    {
        adds: '`class:` is a toggle, not a string',
        of: [],
        spells: ['class'],
        source: CLASS_TOGGLE,
        view: ClassToggle,
    },
    {
        adds: 'one style PROPERTY, by the same rule and with the same refusal on a component',
        of: [],
        spells: ['style'],
        source: STYLE_PROPERTY,
        view: StyleProperty,
    },
    {
        adds: 'a spread — every key an attribute here, a prop on a component',
        of: [],
        spells: ['spread'],
        source: SPREAD,
        view: Spread,
    },
    {
        adds: 'an `await` in the hole, and the three positions that refuse one',
        of: [],
        spells: ['expression'],
        source: AWAITED,
        view: Awaited,
    },
    {
        adds: '`raw(…)` in a slot TRUSTS a string — the one place the escape is skipped',
        of: ['raw'],
        spells: ['expression'],
        source: TRUSTED,
        view: Trusted,
    },

    // --- the blocks ---------------------------------------------------------------
    { adds: 'a branch, and its arms', of: [], spells: ['if'], source: BRANCH, view: Branch },
    {
        adds: '`{:else if}` is a CHAIN of siblings, so exactly one arm shows',
        of: [],
        spells: ['if'],
        source: MORE_ARMS,
        view: MoreArms,
    },
    {
        adds: 'a probe picks the arm, and a FAILURE needs an arm of its own',
        of: [],
        spells: ['if'],
        source: FAILURE_ARM,
        view: FailureArm,
    },
    { adds: 'a list, once per item, matched by POSITION', of: [], spells: ['for'], source: LIST, view: List },
    {
        adds: '`by` is the KEY, so a row that moves is MOVED',
        of: [],
        spells: ['for'],
        source: KEYED,
        view: Keyed,
    },
    {
        adds: 'a second binding is the INDEX — the one thing that must never be the key',
        of: [],
        spells: ['for'],
        source: INDEXED,
        view: Indexed,
    },
    {
        adds: 'the same block over something still ARRIVING, and `{:catch}` for a source that fails',
        of: [],
        spells: ['for'],
        source: STREAMED,
        view: Streamed,
    },
    {
        adds: 'one expression against many arms, instead of repeating the subject per line',
        of: [],
        spells: ['switch'],
        source: SWITCHED,
        view: Switched,
    },
    {
        adds: 'an error boundary with JavaScript semantics, and therefore SYNCHRONOUS',
        of: [],
        spells: ['try'],
        source: BOUNDARY,
        view: Boundary,
    },

    // --- the tags an author writes rather than the browser's -----------------------
    {
        adds: "that list's row as a component, which TAKES it as a prop",
        of: ['props'],
        spells: ['tag'],
        source: ROW_COMPONENT,
        view: RowComponent,
    },
    {
        adds: 'whatever is written between the tags, arriving at `<slot/>`',
        of: [],
        spells: ['slot'],
        source: CHILDREN,
        view: Children,
    },
    {
        adds: 'a component written INLINE, invoked as a tag and passable as a value',
        of: [],
        spells: ['component'],
        source: INLINE,
        view: Inline,
    },
    {
        adds: 'the same component hand-written — `html` is the tag the compiler was emitting',
        of: [],
        spells: ['tag'],
        source: HAND_WRITTEN,
        view: Row,
    },
    {
        adds: 'a component is a VALUE, so a STATE can choose which one — and the tag re-mounts on a change',
        of: [],
        spells: ['tag'],
        source: CHOSEN,
        view: Chosen,
    },
    {
        adds: 'the other scope: `<script module>` is per module and the only one that may export',
        of: [],
        spells: ['script'],
        source: TWO_SCOPES,
        view: TwoScopes,
    },
    {
        adds: 'a NESTED setup block is branch-local, which in a `{#for}` is per row',
        of: [],
        spells: ['script'],
        source: NESTED_SCRIPT,
        view: NestedScript,
    },
    {
        adds: 'component-scoped CSS, mechanically — every element carries the scope',
        of: [],
        spells: ['styles'],
        source: SCOPED_STYLES,
        view: ScopedStyles,
    },
    {
        adds: 'a nested `<style>` scopes a SUBTREE, and a scope opens inward only',
        of: [],
        spells: ['styles'],
        source: NESTED_STYLE,
        view: NestedStyle,
    },
    // Last, and the two of them are the same lesson from the child's side: a prop is a state, so what a
    // rung here adds is what the POSITION did with it. Both need a parent to mean anything, which is
    // why they sit after the tag that writes one.
    //
    // TWO FILES on the first, and the second is the parent because the parent is the whole lesson: the
    // child cannot tell whether it was handed the state or a copy, so a rung showing only the child
    // shows none of it. This used to claim the opposite — that declaring the prop `State<…>` was what
    // let the child write back — which was never true in either lane: both spellings emitted the same
    // `propState`, and a child declaring a plain `string` writes back identically. `.abide` refuses
    // the source spelling in a props type now, so the claim cannot come back.
    {
        adds: 'the PARENT decides whether a child’s write comes back — the state, or a read of it',
        of: ['props'],
        spells: ['bind-value'],
        source: WRITTEN_BACK,
        client: WRITTEN_BACK_PARENT,
        view: WrittenBack,
    },
    {
        adds: 'a FUNCTION member is a callback — handed over as written, and CALLED',
        of: ['props'],
        spells: ['events'],
        source: CALLBACK,
        view: Callback,
    },
]
