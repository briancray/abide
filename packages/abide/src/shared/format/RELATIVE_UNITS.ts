// The units `format.relative` writes a gap in, largest first, each with its length in milliseconds.
// A leaf, so the clock that ticks a `Time` steps at the same boundaries the label is written at.
export const RELATIVE_UNITS = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['week', 604_800_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
] as const
