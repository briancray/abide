/**
 * Why the bun at `version` cannot run abide, which asks for `range` — or `undefined` where it can.
 *
 * 38.123 — named in full, both versions and the way out, since an older bun fails later and
 * somewhere unrelated, if at all.
 */
export function runtimeRefusal(
    version: string,
    range: string,
): string | undefined {
    if (Bun.semver.satisfies(version, range)) return undefined
    return `this is bun ${version}, and abide needs bun ${range}. Run \`bun upgrade\`, or install a bun in that range. RULEBOOK 38.123.`
}
