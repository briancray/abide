// The mark that tells a `Reactive` from any other thenable, and a leaf because both
// seams read it. RULEBOOK 1.6: where a load is told apart from a value a `Reactive` is
// taken as a value, so every guard that could meet one reads this BEFORE it reads
// `then` — a `Reactive` is thenable by 1.4, and a guard written the other way round
// silently settles a live value to one snapshot.
export const REACTIVE_BRAND: unique symbol = Symbol.for('abide.reactive')
