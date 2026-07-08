import type { InterpolationKind } from './types/InterpolationKind.ts'
import type { ValuePositionInterpolation } from './types/ValuePositionInterpolation.ts'

/*
The Stage E guard rule (ADR-0019): given a value-position interpolation's classified
kind and position, returns the compile-error message when a `Promise`/`AsyncIterable`
sits where it can't render over time (so it would silently stringify to `[object
Promise]`), or undefined when it's allowed. A `Promise` errors in EVERY value position;
an `AsyncIterable` errors everywhere EXCEPT `{#for await}`, its sanctioned iterable. A
`sync` value is always allowed. Shared by the two guard sites so both raise identically.
*/
export function asyncValuePositionError(
    kind: InterpolationKind,
    position: ValuePositionInterpolation['position'],
): string | undefined {
    const errors = kind === 'promise' || (kind === 'asyncIterable' && position !== 'for await')
    if (!errors) {
        return undefined
    }
    const where =
        position === 'attribute'
            ? 'an attribute'
            : position === 'if'
              ? 'an `{#if}`'
              : position === 'switch'
                ? 'a `{#switch}`'
                : 'an `{#each}`'
    return `[abide] a \`Promise\`/\`AsyncIterable\` can't be used in ${where} here — render it as content (\`{await …}\` or \`{expr}\`), or wrap it in \`computed(await …)\` / \`computed(getStream())\` and bind the resulting cell.`
}
