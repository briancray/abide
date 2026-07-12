import type { LiftPosition } from './liftAsyncSubExpressions.ts'
import type { TemplateAttr } from './types/TemplateAttr.ts'

/* The value position an attribute's authored expression occupies for async lowering, or undefined
   when the attribute carries no async-liftable expression. Only `name={code}` (`expression`) and
   `name="… {code} …"` (`interpolated`) bind a rendered value a promise/stream sub-expression may sit
   in and lift to a peek-cell — every element value position is `'attribute'`. The directive
   attributes (`on*` event, `bind:`, `class:`, `style:`, `attach`, `{...}` spread) evaluate to a
   handler / lvalue / attachment / spread object, not a rendered value, so their expressions are NOT
   lifted; a `static` literal carries no expression at all. Both compile front-ends read this so the
   runtime's injected cells and the shadow's peek-wrap cover the SAME attribute set — the two can
   never silently disagree on which attribute expressions are async. */
export function attrLiftPosition(attr: TemplateAttr): LiftPosition | undefined {
    if (attr.kind === 'expression' || attr.kind === 'interpolated') {
        return 'attribute'
    }
    return undefined
}
