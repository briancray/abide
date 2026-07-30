// painter(coloured) — the ANSI vocabulary every abide terminal surface paints with: the REPL banner
// and prompt, and the `abide <command>` banners.
//
// It lives next to `colourEnabled` because the two are one decision in two halves — that one answers
// WHETHER to style, this one is the only spelling of HOW. Escapes stated once and handed out as
// functions, so an uncoloured surface is the same call sites with identity functions rather than a
// second code path that has to be kept in step. It used to be a private helper inside
// `interactiveCli.ts`; the CLI banners needed the same five escapes, and a second copy of a palette is
// how two surfaces end up dimming to different greys.

const STYLE = {
    reset: '\u001b[0m',
    dim: '\u001b[2m',
    bold: '\u001b[1m',
    cyan: '\u001b[36m',
    red: '\u001b[31m',
} as const

export interface Paint {
    dim(text: string): string
    bold(text: string): string
    // The one hue a surface leans on to mark its own furniture (the REPL prompt, a banner's row
    // marker) — named for the ROLE rather than for cyan, so the palette can move without a rename.
    accent(text: string): string
    error(text: string): string
    prompt: string
}

export function painter(coloured: boolean): Paint {
    if (!coloured) {
        return {
            dim: (text) => text,
            bold: (text) => text,
            accent: (text) => text,
            error: (text) => text,
            prompt: '> ',
        }
    }
    return {
        dim: (text) => `${STYLE.dim}${text}${STYLE.reset}`,
        bold: (text) => `${STYLE.bold}${text}${STYLE.reset}`,
        accent: (text) => `${STYLE.cyan}${text}${STYLE.reset}`,
        error: (text) => `${STYLE.red}${text}${STYLE.reset}`,
        // The prompt is the one thing on screen that is always in the same place, so colouring it is
        // what lets you find where the last command's output ended when you scroll back.
        prompt: `${STYLE.cyan}\u276f${STYLE.reset} `,
    }
}
