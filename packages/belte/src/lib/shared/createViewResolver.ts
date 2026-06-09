import type { Errors } from '../browser/types/Errors.ts'
import type { Layouts } from '../browser/types/Layouts.ts'
import type { Pages } from '../browser/types/Pages.ts'
import { nearestLayoutPrefix, normalizeLayoutPrefixes } from './nearestLayoutPrefix.ts'
import type { ResolvedView } from './types/ResolvedView.ts'
import type { ViewResolver } from './types/ViewResolver.ts'

/*
Isomorphic view resolution: a matched route in, mountable components out.
Owns the layout/error questions end to end — prefix normalization at
construction, nearest-ancestor selection (deepest prefix that is an ancestor
of the route, no stacking) and the parallel page+layout module load per call
— so the server renderer and the client navigator resolve a view through the
same rules without knowing them. `error` resolves the nearest error.svelte
for a failed pathname inside that pathname's nearest layout, undefined when
no error boundary covers it.
*/
export function createViewResolver({
    pages,
    layouts,
    errors,
}: {
    pages: Pages
    layouts?: Layouts
    errors?: Errors
}): ViewResolver {
    const layoutPrefixes = normalizeLayoutPrefixes(Object.keys(layouts ?? {}))
    const errorPrefixes = normalizeLayoutPrefixes(Object.keys(errors ?? {}))

    /* Loads a view module and its nearest layout concurrently, unwrapping defaults. */
    async function loadWithLayout(
        route: string,
        loadViewModule: () => Promise<{ default: ResolvedView['Page'] }>,
    ): Promise<ResolvedView> {
        const layoutPrefix = nearestLayoutPrefix(route, layoutPrefixes)
        const [viewModule, layoutModule] = await Promise.all([
            loadViewModule(),
            layoutPrefix && layouts ? layouts[layoutPrefix]() : Promise.resolve(undefined),
        ])
        return { Page: viewModule.default, Layout: layoutModule?.default }
    }

    return {
        has: (route) => Boolean(pages[route]),

        /* async so an unknown route rejects rather than throwing sync — one error mode for callers. */
        view: async (route) => {
            const loadPage = pages[route]
            if (!loadPage) {
                throw new Error(`[belte] unknown route: ${route}`)
            }
            return loadWithLayout(route, loadPage)
        },

        error: async (pathname) => {
            const errorPrefix = nearestLayoutPrefix(pathname, errorPrefixes)
            if (!errorPrefix || !errors) {
                return undefined
            }
            return loadWithLayout(pathname, errors[errorPrefix])
        },

        prefixes: (route) => ({
            layout: nearestLayoutPrefix(route, layoutPrefixes),
            error: nearestLayoutPrefix(route, errorPrefixes),
        }),
    }
}
