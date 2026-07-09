import type { InterpolationKind } from './types/InterpolationKind.ts'
import type { ValuePositionInterpolation } from './types/ValuePositionInterpolation.ts'

/*
The narrowed value-position guard (ADR-0032): a promise/`AsyncIterable` (sub)expression now LIFTS
to a peek-cell in every position — an attribute, an `{#if}`/`{#switch}` subject, a plain `{#for}`
source — reading `undefined` while pending. The ONE remaining error is a raw `AsyncIterable`
driving a PLAIN `{#for}`: a frame is not a collection, so iterate its frames with `{#for await}`
(the `for await` position is exempt). Everything else (promises everywhere, streams in attribute/
`{#if}`/`{#switch}`/content) is allowed. Shared by the build front-end (`liftAsyncSubExpressions`
throws the same message) and `abide check` (`collectAbideDiagnostics`).
*/
export function asyncValuePositionError(
    kind: InterpolationKind,
    position: ValuePositionInterpolation['position'],
): string | undefined {
    if (kind !== 'asyncIterable' || position !== 'each') {
        return undefined
    }
    return "[abide] an `AsyncIterable` can't drive a plain `{#for}` — iterate its frames with `{#for await}`."
}
