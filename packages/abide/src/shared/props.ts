/**
 * A component's props, as the child declares them. Compiled away inside a `.abide` file.
 *
 * Section 33. NOTHING HERE RUNS IN A COMPILED PAGE. `props<Props>()` is LOWERED: the compiler
 * replaces the call with the record of accessors the caller passed, and every name the pattern
 * binds becomes a read of its accessor (33.4, 33.5, 33.9). The export exists because the import an
 * author writes has to resolve — 19.11 has valid TypeScript go on compiling — and because the TYPE
 * is what makes a prop's shape the one the child declared.
 *
 * THE RETURN TYPE IS THE PLAIN SHAPE, not one accessor per key, and that is the point of the
 * lowering rather than a gap in it: `amount.toFixed(2)` is what an author writes and what the
 * checker sees, and the accessor is the compiler's business. A prop is declared as its value's
 * type, never as a `Reactive`, and one the child writes is lowered to a cell (33.6, 33.7).
 */
export function props<Props = Record<string, unknown>>(): {
    [Key in keyof Props]: Props[Key]
} {
    // Reached only from a `.abide` nothing compiled, or from a `.ts` that imported it. Either way
    // there is no instance to read, and answering an empty record would make a missing prop read
    // `undefined` instead of saying so.
    throw new Error(
        'abide: props() is compiled away inside a .abide file, and there is no component instance to read outside one. RULEBOOK 33.1.',
    )
}
