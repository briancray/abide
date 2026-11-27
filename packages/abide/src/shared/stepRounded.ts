/**
 * `value` rounded to the decimals `step` and `from` are written in, so three steps of a tenth from
 * nothing read as three tenths rather than as the float their sum makes.
 *
 * `slider` (51.86) and `spinbutton` (56.32) alike: each lands a value a whole number of steps from
 * `from`, and the arithmetic that lands it is binary.
 */
export function stepRounded(value: number, step: number, from: number): number {
    const places = Math.max(decimalsOf(step), decimalsOf(from))
    return Number(value.toFixed(places))
}

function decimalsOf(number: number): number {
    if (!Number.isFinite(number)) return 0
    return (String(number).split('.')[1] ?? '').length
}
