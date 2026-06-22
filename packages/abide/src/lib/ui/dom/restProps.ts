import type { UiProps } from '../runtime/types/UiProps.ts'

/*
The rest of a component's props — `const { foo, ...rest } = props()` — as a live
object of the UNCONSUMED prop values. A child receives prop THUNKS, so `rest.key`
unwraps them (`$props[key]?.()`), tracking as a reactive dependency; a top-level
page/layout instead receives its route params as PLAIN values, so a non-function
value is returned as-is rather than called (which would throw `value is not a
function`). The explicitly-destructured keys and the `$children` slot are excluded.
Enumerable (`ownKeys`/`for…in`/`Object.keys`), so `{...rest}` can forward the
remaining props onto a child or a native element. Key membership is live, but a
consumer that captures the key SET (a `{...rest}` spread) snapshots it at that point.
*/
// @documentation plumbing
export function restProps(props: UiProps, consumed: string[]): Record<string, unknown> {
    const skip = new Set([...consumed, '$children'])
    const bag = props as Record<string, unknown>
    const visible = (key: string | symbol): key is string =>
        typeof key === 'string' && !skip.has(key) && key in bag
    const read = (key: string): unknown =>
        typeof bag[key] === 'function' ? (bag[key] as () => unknown)() : bag[key]
    return new Proxy(
        {},
        {
            get: (_target, key) => (visible(key) ? read(key) : undefined),
            has: (_target, key) => visible(key),
            ownKeys: () => Reflect.ownKeys(bag).filter(visible),
            getOwnPropertyDescriptor: (_target, key) =>
                visible(key) ? { enumerable: true, configurable: true } : undefined,
        },
    )
}
