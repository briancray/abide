/** The JSON value `text` spells, or `undefined` where it spells none. */
export function parsedJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return undefined
    }
}
