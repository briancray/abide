import { pageUrlForFile } from '../../shared/pageUrlForFile.ts'
import { routeParamsShape } from '../../shared/routeParamsShape.ts'

const PAGES_SEGMENT = '/src/ui/pages/'

/*
The `props()` type for a `.abide` file's check shadow: a page/layout's route param shape
(so `const { id } = props()` infers `id: string`), or undefined for a non-page component
(which keeps the `Record<string, any>` default). Derived from the file path — a `page.abide`
or `layout.abide` under `src/ui/pages/` maps through `pageUrlForFile` to its route.
*/
export function pagePropsType(abidePath: string): string | undefined {
    const pagesAt = abidePath.indexOf(PAGES_SEGMENT)
    if (pagesAt === -1) {
        return undefined
    }
    const base = abidePath.slice(abidePath.lastIndexOf('/') + 1)
    if (base !== 'page.abide' && base !== 'layout.abide') {
        return undefined
    }
    const relPath = abidePath.slice(pagesAt + PAGES_SEGMENT.length)
    return routeParamsShape(pageUrlForFile(relPath))
}
