// The number a text reads as, or `undefined` where it reads as none. Blank text is not zero, though
// `Number('')` says it is.
export function numberFromText(text: string): number | undefined {
    if (text.trim() === '') return undefined
    const number = Number(text)
    return Number.isNaN(number) ? undefined : number
}
