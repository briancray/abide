// THE SITES A VISITOR ALWAYS ALLOWS (44.62), kept beside the handler install wrote so uninstall takes
// them too. ONE PER SITE AND HOLDER: a link pairs unasked only where its code was minted for the same
// holder `/__abide/bridge` named when the visitor chose to always allow it — a code an attacker minted
// is minted for the attacker, and is asked about.
import { siteOf } from './pairingLink.ts'

/** A site paired unasked, for one holder, while a link asks for none but `tools`. */
export type AllowedSite = { site: string; holder: string; tools: string[] }

/** The file the sites `directory`'s handler always allows are kept in. */
export function allowedIn(directory: string): string {
    return `${directory}/allowed.json`
}

/** The sites kept in `file`, or none where it is not there. */
export async function allowedSites(file: string): Promise<AllowedSite[]> {
    const kept = Bun.file(file)
    return (await kept.exists()) ? ((await kept.json()) as AllowedSite[]) : []
}

/** Whether `sites` let a link for `site`, minted for `holder` and asking for `tools`, pair unasked. 44.62. */
export function allowsUnasked(
    sites: readonly AllowedSite[],
    site: string,
    holder: string,
    tools: readonly string[],
): boolean {
    for (const allowed of sites)
        if (allowed.site === site && allowed.holder === holder) {
            for (const tool of tools)
                if (!allowed.tools.includes(tool)) return false
            return true
        }
    return false
}

/** Keeps `site` always allowed for `holder`, with `tools` beside the ones allowed before. */
export async function allowAlways(
    file: string,
    site: string,
    holder: string,
    tools: readonly string[],
): Promise<void> {
    const sites = await allowedSites(file)
    let entry = sites.find(
        (allowed) => allowed.site === site && allowed.holder === holder,
    )
    if (entry === undefined) {
        entry = { site, holder, tools: [] }
        sites.push(entry)
    }
    for (const tool of tools)
        if (!entry.tools.includes(tool)) entry.tools.push(tool)
    await Bun.write(file, JSON.stringify(sites, null, 4))
}

/**
 * Forgets `site` — written as a link names it, or bare, `example.com/app` — or every site where none is
 * named, and answers how many were forgotten. 44.63.
 */
export async function forget(file: string, site?: string): Promise<number> {
    const sites = await allowedSites(file)
    const kept: AllowedSite[] = []
    // Compared without the scheme, so a bare name matches the `https:` or loopback `http:` site kept.
    const named =
        site === undefined
            ? undefined
            : withoutScheme(
                  siteOf(
                      new URL(site.includes('://') ? site : `https://${site}`),
                  ),
              )
    for (const allowed of sites)
        if (named !== undefined && withoutScheme(allowed.site) !== named)
            kept.push(allowed)
    if (kept.length !== sites.length)
        await Bun.write(file, JSON.stringify(kept, null, 4))
    return sites.length - kept.length
}

function withoutScheme(site: string): string {
    return site.slice(site.indexOf('://') + 3)
}
