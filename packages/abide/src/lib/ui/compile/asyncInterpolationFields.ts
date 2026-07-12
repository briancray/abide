import { attrLiftPosition } from './attrLiftPosition.ts'
import type { AsyncInterpolationField } from './types/AsyncInterpolationField.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/* No control-flow subject to record — the writeback for a content/attribute field. */
const NO_OP = (): void => {}

/*
Enumerates the async-liftable interpolation fields of ONE template node — content text parts,
value-position attributes (`attrLiftPosition`), and the control-flow subjects — as the single shared
reading both compile front-ends lower from. It mirrors `ifPlan`/`awaitPlan` (a per-node structural
plan the two back-ends read), applied to interpolations: the runtime lifts each field to an injected
`computed` cell and `write`s the rewritten `__vN` reference back — marking `setAsyncSubject` when a
whole subject collapsed to one bare cell — while the shadow reads the same `code`/`loc`/`position` to
peek-wrap its value-typed projection. Neither can disagree on WHICH interpolations are async or their
position.

Fields are yielded in source order (text parts / attributes before the control-flow subject) so the
runtime's global `__vN` cell numbering stays deterministic. The node's children are NOT descended —
each front-end recurses on its own. A `{#for await}` source is the sanctioned `AsyncIterable`, drained
unchanged, so it is never lifted (excluded); `await` / `component` / `snippet` / `try` carry no lifted
field (an `await`'s promise and a component's props route through their own lowerings).
*/
export function asyncInterpolationFields(node: TemplateNode): AsyncInterpolationField[] {
    const fields: AsyncInterpolationField[] = []
    switch (node.kind) {
        case 'text':
            for (const part of node.parts) {
                if (part.kind === 'expression' && part.loc !== undefined) {
                    fields.push({
                        code: part.code,
                        loc: part.loc,
                        position: 'content',
                        subject: false,
                        write: (code) => {
                            part.code = code
                        },
                        setAsyncSubject: NO_OP,
                    })
                }
            }
            return fields
        case 'element':
            for (const attr of node.attrs) {
                if (attr.kind === 'interpolated') {
                    for (const part of attr.parts) {
                        if (part.kind === 'expression' && part.loc !== undefined) {
                            fields.push({
                                code: part.code,
                                loc: part.loc,
                                position: 'attribute',
                                subject: false,
                                write: (code) => {
                                    part.code = code
                                },
                                setAsyncSubject: NO_OP,
                            })
                        }
                    }
                    continue
                }
                /* Only `expression` attributes lift (directives evaluate to a handler/lvalue, not a
                   rendered value) — `attrLiftPosition` is the shared gate. */
                const position = attrLiftPosition(attr)
                if (
                    position !== undefined &&
                    attr.kind === 'expression' &&
                    attr.loc !== undefined
                ) {
                    fields.push({
                        code: attr.code,
                        loc: attr.loc,
                        position,
                        subject: false,
                        write: (code) => {
                            attr.code = code
                        },
                        setAsyncSubject: NO_OP,
                    })
                }
            }
            return fields
        case 'if':
            if (node.loc !== undefined) {
                fields.push({
                    code: node.condition,
                    loc: node.loc,
                    position: 'if',
                    subject: true,
                    write: (code) => {
                        node.condition = code
                    },
                    setAsyncSubject: (asyncSubject) => {
                        node.asyncSubject = asyncSubject
                    },
                })
            }
            return fields
        case 'switch':
            if (node.loc !== undefined) {
                fields.push({
                    code: node.subject,
                    loc: node.loc,
                    position: 'switch',
                    subject: true,
                    write: (code) => {
                        node.subject = code
                    },
                    setAsyncSubject: (asyncSubject) => {
                        node.asyncSubject = asyncSubject
                    },
                })
            }
            return fields
        case 'case':
            /* An `{:elseif}` condition — a truthy-tested control-flow subject, lifted like an
               `{#if}` head so a bare async `{:elseif}` holds the cond-chain while it loads. */
            if (node.condition !== undefined && node.loc !== undefined) {
                fields.push({
                    code: node.condition,
                    loc: node.loc,
                    position: 'if',
                    subject: true,
                    write: (code) => {
                        node.condition = code
                    },
                    setAsyncSubject: (asyncSubject) => {
                        node.asyncSubject = asyncSubject
                    },
                })
            }
            return fields
        case 'each':
            /* A plain `{#for}` source lifts (a promise-of-iterable → empty while pending); a
               `{#for await}` source is the sanctioned `AsyncIterable`, never lifted. */
            if (node.loc !== undefined && !node.async) {
                fields.push({
                    code: node.items,
                    loc: node.loc,
                    position: 'each',
                    subject: false,
                    write: (code) => {
                        node.items = code
                    },
                    setAsyncSubject: NO_OP,
                })
            }
            return fields
        default:
            return fields
    }
}
