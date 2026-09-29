/**
 * Each token of a `;q=`-weighted list header, to its quality, in the order the header lists them.
 *
 * For `accept` and `accept-encoding`. A QUALITY THAT DOES NOT PARSE REFUSES, rather than reading as
 * the default of 1, and `q=0` is a refusal rather than a low preference.
 */
export function qualitiesOf(header: string): Map<string, number> {
    const qualities = new Map<string, number>()
    for (const part of header.split(',')) {
        const [token, ...parameters] = part.split(';')
        let quality = 1
        for (const parameter of parameters) {
            const [key, value] = parameter.split('=')
            if (key?.trim() === 'q') quality = Number(value)
        }
        qualities.set(
            (token as string).trim().toLowerCase(),
            Number.isNaN(quality) ? 0 : quality,
        )
    }
    return qualities
}
