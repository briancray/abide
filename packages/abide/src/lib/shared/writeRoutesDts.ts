import { pageUrlForFile } from './pageUrlForFile.ts'
import { parseRouteSegments } from './parseRouteSegments.ts'
import { writeDts } from './writeDts.ts'

/*
Walks a `[name]` / `[...rest]` route URL and returns the param shape it
declares. Catch-all segments map to `string` under their declared name —
the server's toBunRoutePattern renames Bun's `*` key back to that name
when dispatching, so the page component sees `params.rest`, not
`params['*']`.
*/
function paramsForRoute(routeUrl: string): Record<string, 'string'> {
    return Object.fromEntries(
        parseRouteSegments(routeUrl)
            .filter((segment) => segment.kind === 'param')
            .map((segment) => [segment.name, 'string'] as const),
    )
}

function renderParamsShape(shape: Record<string, 'string'>): string {
    const keys = Object.keys(shape)
    if (keys.length === 0) {
        return 'Record<string, never>'
    }
    return `{ ${keys.map((key) => `${JSON.stringify(key)}: string`).join('; ')} }`
}

/*
Emits a `.d.ts` that augments abide's `Routes` interface with one entry per
page file in the project. Page picks this up as a discriminated union keyed
on `route`, so `if (page.route === '/media/[id]') page.params.id` is typed
automatically without consumers writing route types by hand.
The file is written to `src/.abide/routes.d.ts` so the consumer's existing
src tsconfig include picks it up with no extra configuration. The augmented
module is keyed on the name the project imports abide under (`importName`),
so the augmentation matches the consumer's `page` import whether abide is
installed directly (`abide`) or behind an alias.
*/
export async function writeRoutesDts({
    cwd,
    pageFiles,
    importName,
}: {
    cwd: string
    pageFiles: string[]
    importName: string
}): Promise<void> {
    const routes = pageFiles
        .map((file) => ({
            route: pageUrlForFile(file),
            params: paramsForRoute(pageUrlForFile(file)),
        }))
        .toSorted((a, b) => a.route.localeCompare(b.route))
    const entries = routes
        .map(
            ({ route, params }) => `        ${JSON.stringify(route)}: ${renderParamsShape(params)}`,
        )
        .join('\n')
    /* Keys-only mirror for url()'s autocomplete (values unused — PathParams derives the shape). */
    const urlKeys = routes.map(({ route }) => `        ${JSON.stringify(route)}: true`).join('\n')
    const body = `declare module '${importName}/shared/page' {
    interface Routes {
${entries}
    }
}

declare module '${importName}/shared/url' {
    interface PageRoutes {
${urlKeys}
    }
}`
    await writeDts(cwd, 'routes', body)
}
