/** Five thousand pages of the site, with what each brought in. */
export const PAGES: { path: string; views: number; signups: number }[] = []
for (let at = 0; at < 5000; at += 1)
    PAGES.push({
        path: `/blog/post-${at}`,
        views: (at * 7919) % 50_000,
        signups: (at * 104_729) % 900,
    })

/** The five pages that brought in the most, timed as the layer `sort`. */
export function topFive(by: 'views' | 'signups') {
    performance.mark('sort:start')
    const ranked = [...PAGES].sort((a, b) => b[by] - a[by]).slice(0, 5)
    performance.measure('sort', 'sort:start')
    return ranked
}
