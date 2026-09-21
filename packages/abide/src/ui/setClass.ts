import { WORK } from '#shared/WORK.ts'

// 32.11 on the client — `class:name` sets ONE class, and keeps setting it. Written through
// `classList` rather than through the `class` attribute the server built, for the reason
// `setStyleProperty` is written through the CSSOM: the server MERGED every `class:name` on the
// element into that one attribute beside the author's own `class`, so writing the attribute back
// would take the other names with it, where `toggle` touches exactly the one this binding owns.
//
// NO COMPARE OF ITS OWN, unlike `setAttribute` and `setStyleProperty`. `toggle` given a `force`
// is SPECIFIED to run the update steps only where the token's presence differs from it, so the
// branch its two siblings each carry is already inside the call. That is the spec and not a number
// taken here, and it is not one this package can take: `measure` counts the CALL, and happy-dom
// records an attribute mutation for a toggle that changes nothing, so neither instrument in
// `bun test` can tell the two apart. Pricing it needs `RecalcStyleCount` off the engine lane.
//
// THE VALUE IS A CONDITION, not a string: `class:overdue={days > 0}` is the shape 32.11 names, so
// the coercion is the whole of the value handling and there is nothing to escape. The NAME is the
// author's own markup, fixed where the module was emitted.
export function setClass(element: Element, name: string, on: unknown): void {
    WORK.bindingRuns += 1
    element.classList.toggle(name, Boolean(on))
}
