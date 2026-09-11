// WHERE A COST CROSSES PERCEPTION, in nanoseconds. Optimise here rather than where the
// ratio is largest: a 2x on a 40 µs op is invisible. A leaf, because `report` and
// `engine` both name these and a constant crossing a seam is not copied.
export const THRESHOLDS = {
    // One frame at 60 Hz. Click -> paint is quantised to it, so every implementation
    // under one frame reads the same ~16.7 ms and the wall clock is a perception
    // detector rather than a blunt one.
    frame: 16_700_000,
    // An interaction budget. Past this the wait is the thing the user is doing.
    interaction: 100_000_000,
} as const
