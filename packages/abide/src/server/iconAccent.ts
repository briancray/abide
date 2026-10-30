// 38.101 — THE LAUNCHER'S ACCENT, TAKEN FROM THE APP'S ICON. The icon is the one thing every desktop
// app already has that says what it looks like, so the launcher reads its color off it rather than
// asking for a theme. Read once by `abide bundle`, from the icon drawn small, and carried in the
// executable as a color.
//
// THE MOST SATURATED HUE, NOT THE AVERAGE: an icon is usually a mark on a ground, and the mean of a
// teal stroke on a near-black square is a muddy gray neither of them is.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const HUE_BINS = 24

/**
 * The accent color of the PNG `png`, as `#rrggbb`, or `undefined` where it has no color to give —
 * a gray icon, or a PNG this reads no pixels of (8-bit RGB or RGBA, not interlaced).
 */
export function iconAccent(png: Uint8Array): string | undefined {
    const pixels = decoded(png)
    if (pixels === undefined) return undefined
    const weights = new Float64Array(HUE_BINS)
    const sums = new Float64Array(HUE_BINS * 3)
    for (let at = 0; at < pixels.data.length; at += pixels.channels) {
        const alpha =
            pixels.channels === 4 ? (pixels.data[at + 3] as number) : 255
        if (alpha < 128) continue
        const red = pixels.data[at] as number
        const green = pixels.data[at + 1] as number
        const blue = pixels.data[at + 2] as number
        const [hue, saturation, lightness] = hsl(red, green, blue)
        if (saturation < 0.25 || lightness < 0.12 || lightness > 0.92) continue
        const bin = Math.floor((hue / 360) * HUE_BINS) % HUE_BINS
        const weight = saturation * (alpha / 255)
        weights[bin] = (weights[bin] as number) + weight
        sums[bin * 3] = (sums[bin * 3] as number) + red * weight
        sums[bin * 3 + 1] = (sums[bin * 3 + 1] as number) + green * weight
        sums[bin * 3 + 2] = (sums[bin * 3 + 2] as number) + blue * weight
    }
    let best = -1
    for (let bin = 0; bin < HUE_BINS; bin += 1)
        if (
            (weights[bin] as number) > 0 &&
            (best === -1 ||
                (weights[bin] as number) > (weights[best] as number))
        )
            best = bin
    if (best === -1) return undefined
    const weight = weights[best] as number
    const [hue, saturation, lightness] = hsl(
        (sums[best * 3] as number) / weight,
        (sums[best * 3 + 1] as number) / weight,
        (sums[best * 3 + 2] as number) / weight,
    )
    // A button's fill: dark enough to carry white text, light enough to read as a color.
    return hex(
        hue,
        Math.min(saturation, 0.85),
        Math.min(Math.max(lightness, 0.32), 0.5),
    )
}

/** `#rrggbb` text that reads on `accent`: near-black on a light one, white on a dark one. */
export function inkOn(accent: string): string {
    const channel = (offset: number): number => {
        const value =
            Number.parseInt(accent.slice(offset, offset + 2), 16) / 255
        return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4
    }
    const luminance =
        0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
    return luminance > 0.4 ? '#1d1d1f' : '#ffffff'
}

function decoded(
    png: Uint8Array,
): { data: Uint8Array; channels: number } | undefined {
    for (let at = 0; at < SIGNATURE.length; at += 1)
        if (png[at] !== SIGNATURE[at]) return undefined
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    let width = 0
    let height = 0
    let channels = 0
    const compressed: Uint8Array[] = []
    let length = 0
    for (let at = 8; at + 8 <= png.length;) {
        const size = view.getUint32(at)
        const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
        const body = png.subarray(at + 8, at + 8 + size)
        if (type === 'IHDR') {
            width = view.getUint32(at + 8)
            height = view.getUint32(at + 12)
            const depth = body[8]
            const color = body[9]
            const interlaced = body[12]
            if (depth !== 8 || interlaced !== 0) return undefined
            if (color === 6) channels = 4
            else if (color === 2) channels = 3
            else return undefined
        } else if (type === 'IDAT') {
            compressed.push(body)
            length += body.length
        } else if (type === 'IEND') break
        at += 12 + size
    }
    if (channels === 0) return undefined
    const joined = new Uint8Array(length)
    let offset = 0
    for (const part of compressed) {
        joined.set(part, offset)
        offset += part.length
    }
    const raw = Bun.inflateSync(joined, { windowBits: 15 })
    const stride = width * channels
    const data = new Uint8Array(stride * height)
    for (let row = 0; row < height; row += 1) {
        const filter = raw[row * (stride + 1)] as number
        const from = row * (stride + 1) + 1
        const to = row * stride
        for (let column = 0; column < stride; column += 1) {
            const value = raw[from + column] as number
            const left =
                column >= channels
                    ? (data[to + column - channels] as number)
                    : 0
            const up = row > 0 ? (data[to - stride + column] as number) : 0
            const corner =
                row > 0 && column >= channels
                    ? (data[to - stride + column - channels] as number)
                    : 0
            let predicted = 0
            if (filter === 1) predicted = left
            else if (filter === 2) predicted = up
            else if (filter === 3) predicted = (left + up) >> 1
            else if (filter === 4) predicted = paeth(left, up, corner)
            data[to + column] = (value + predicted) & 255
        }
    }
    return { data, channels }
}

function paeth(left: number, up: number, corner: number): number {
    const estimate = left + up - corner
    const toLeft = Math.abs(estimate - left)
    const toUp = Math.abs(estimate - up)
    const toCorner = Math.abs(estimate - corner)
    if (toLeft <= toUp && toLeft <= toCorner) return left
    return toUp <= toCorner ? up : corner
}

function hsl(
    red: number,
    green: number,
    blue: number,
): [number, number, number] {
    const r = red / 255
    const g = green / 255
    const b = blue / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const lightness = (max + min) / 2
    if (max === min) return [0, 0, lightness]
    const delta = max - min
    const saturation =
        lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    let hue: number
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0)
    else if (max === g) hue = (b - r) / delta + 2
    else hue = (r - g) / delta + 4
    return [hue * 60, saturation, lightness]
}

function hex(hue: number, saturation: number, lightness: number): string {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
    const part = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
    const base = lightness - chroma / 2
    const sector = Math.floor(hue / 60) % 6
    const [r, g, b] = [
        [chroma, part, 0],
        [part, chroma, 0],
        [0, chroma, part],
        [0, part, chroma],
        [part, 0, chroma],
        [chroma, 0, part],
    ][sector] as [number, number, number]
    let out = '#'
    for (const channel of [r, g, b])
        out += Math.round((channel + base) * 255)
            .toString(16)
            .padStart(2, '0')
    return out
}
