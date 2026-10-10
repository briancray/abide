/**
 * The version an `ETag` names, or `undefined` where it names none.
 *
 * 18.5 — THE VERSION IS THE ETAG'S OPAQUE PART: `"1712"`, or `W/"1712"` once something compressing on
 * the way out weakened it.
 */
export function versionInEtag(
    etag: string | null | undefined,
): number | undefined {
    if (etag === null || etag === undefined) return undefined
    const quoted = etag.startsWith('W/') ? etag.slice(2) : etag
    const version = Number(quoted.replaceAll('"', ''))
    return Number.isFinite(version) ? version : undefined
}
