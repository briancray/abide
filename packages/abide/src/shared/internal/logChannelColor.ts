// A stable colour per channel label, so `abide:rpc` reads as the same shade on every line and the eye
// can separate interleaved channels without reading them. HASHED rather than assigned: the channel set
// is open (an app names its own), so there is no registry to colour against.
//
// One hash serves both sides of the isomorphism — an ANSI 256-colour SGR prefix for the server's
// terminal, the matching CSS colour for `console.log('%c…')` in the browser — so a channel keeps its
// identity across the two surfaces. The palette avoids near-black and near-white: these lines land on
// light AND dark terminals, and a mid-tone reads on both.

const PALETTE: { ansi: string; css: string }[] = [
    { ansi: '\x1b[38;5;39m', css: '#00afff' },
    { ansi: '\x1b[38;5;43m', css: '#00d7af' },
    { ansi: '\x1b[38;5;78m', css: '#5fd787' },
    { ansi: '\x1b[38;5;178m', css: '#d7af00' },
    { ansi: '\x1b[38;5;209m', css: '#ff875f' },
    { ansi: '\x1b[38;5;168m', css: '#d75f87' },
    { ansi: '\x1b[38;5;141m', css: '#af87ff' },
    { ansi: '\x1b[38;5;116m', css: '#87d7d7' },
]

// Memoized: the channel set is fixed and small, while this sits on the per-line emit path.
const COLORS = new Map<string, { ansi: string; css: string }>()

export function logChannelColor(channel: string): { ansi: string; css: string } {
    const existing = COLORS.get(channel)
    if (existing !== undefined) return existing
    // FNV-1a — cheap, and spreads short similar labels (`abide:rpc` / `abide:ssr`) across the palette.
    let hash = 0x811c9dc5
    for (let index = 0; index < channel.length; index++) {
        hash ^= channel.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
    }
    const color = PALETTE[(hash >>> 0) % PALETTE.length] as { ansi: string; css: string }
    COLORS.set(channel, color)
    return color
}
