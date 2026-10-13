// Where a docs example's own `.abide` files are, for the two readers that pair one with its
// hand-written arm under `arms/`: `bench:compiler` and the arm tests.

/** The docs app's root. Its paths are what an example manifest names. */
export const DOGFOOD = new URL('../../dogfood/', import.meta.url)

const PAGES = new Bun.Glob('src/**/page.abide')

/**
 * The component a docs example renders, as a path relative to the docs app's root, or `undefined`
 * where no page embeds an example of that name.
 *
 * AN EXAMPLE IS NAMED BY ITS CARD: `<Example id="rpc-call">` on the page that embeds it, around the
 * one component it renders, which the page imports.
 */
export async function exampleComponentOf(
    name: string,
): Promise<string | undefined> {
    for (const page of PAGES.scanSync({ cwd: DOGFOOD.pathname })) {
        const text = await Bun.file(new URL(page, DOGFOOD)).text()
        const card = text.indexOf(`id="${name}"`)
        if (card === -1) continue
        const tag = /<([A-Z]\w*)/.exec(text.slice(text.indexOf('>', card)))?.[1]
        const specifier = new RegExp(`import ${tag} from '([^']+)'`).exec(
            text,
        )?.[1]
        if (specifier === undefined) continue
        return resolvedFrom(page, specifier)
    }
    return undefined
}

// Through the app's alias or relative to the file, as a page's own imports are.
function resolvedFrom(file: string, specifier: string): string {
    if (specifier.startsWith('#src/'))
        return `src/${specifier.slice('#src/'.length)}`
    return new URL(specifier, new URL(file, DOGFOOD)).pathname.slice(
        DOGFOOD.pathname.length,
    )
}

/**
 * Lists a docs example's `.abide` files, paths relative to the docs app's root.
 *
 * AN EXAMPLE'S `.abide` FILES are the component its card renders and every component that one
 * invokes, walked off the imports: a child component can be part of the example without being a
 * tab on its card.
 */
export async function abideSourcesOf(name: string): Promise<string[]> {
    const component = await exampleComponentOf(name)
    if (component === undefined)
        throw new Error(`harness: no docs page embeds an example named ${name}`)
    const sources: string[] = []
    const pending = [component]
    while (pending.length > 0) {
        const path = pending.pop() as string
        if (sources.includes(path)) continue
        sources.push(path)
        const text = await Bun.file(new URL(path, DOGFOOD)).text()
        for (const [, specifier] of text.matchAll(
            /from '([^']+\.abide)'(?! with)/g,
        ))
            if (
                (specifier as string).startsWith('#src/') ||
                (specifier as string).startsWith('.')
            )
                pending.push(resolvedFrom(path, specifier as string))
    }
    return sources
}
