// What the value form is handed where it was CALLED WITH NO ARGUMENT, told apart from one called with
// `undefined`: the first lands nothing (4.14) and the second lands `undefined` (4.15).
export const NO_INITIAL: unique symbol = Symbol('no initial')
