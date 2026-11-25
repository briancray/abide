// 38.220 — THE MIGRATION OFF A CHART'S `svg` PART: the root of a `chart` may be any element, so the
// part spread on it is `root`, from the release this migration is keyed to on.
//
// A SCAN, NOT A PARSE, and a conservative one: `svg` is renamed only where it is read as a member of
// a name the same file binds straight to a `chart(` call. `pie` and `sparkline` keep `svg`, so a
// name bound to anything else — a prop typed `ChartParts`, a chart made in another file — is left
// for the checker to name. An `.abide` file is renamed whole: its markup spreads what its script
// binds.

// `const plot = chart(`, with a type annotation or none, and `chart` itself not read as a member.
const BOUND_TO_CHART =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*chart\s*\(/g

/** 38.220 — `text` with each `svg` read off a name bound to a `chart(` call read as `root`. */
export function toChartRoot(text: string): string {
    if (!text.includes('chart') || !text.includes('svg')) return text
    let renamed = text
    for (const [, name] of text.matchAll(BOUND_TO_CHART)) {
        const escaped = (name as string).replace(/\$/g, '\\$')
        renamed = renamed.replace(
            new RegExp(
                `(?<![\\w$])(?<![^.]\\.)(${escaped}\\s*\\??\\.\\s*)svg(?![\\w$])`,
                'g',
            ),
            '$1root',
        )
    }
    return renamed
}
