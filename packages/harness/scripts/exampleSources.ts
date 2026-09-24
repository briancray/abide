// Where a docs example's own `.abide` files are, for the two readers that pair one with its
// hand-written arm under `arms/`: `bench:compiler` and the arm tests.

// The docs app's root. Its paths are what an example manifest names.
export const DOGFOOD = new URL('../../dogfood/', import.meta.url)

// AN EXAMPLE'S `.abide` FILES are the component its card renders and every component that one
// invokes, walked off the imports: the manifest's `files` is what a reader is SHOWN, and a child
// component can be part of the example without being a tab on its card.
export async function abideSourcesOf(name: string): Promise<string[]> {
    const manifest = (await Bun.file(
        new URL(`examples/${name}.json`, DOGFOOD),
    ).json()) as { render: string }
    const sources: string[] = []
    const pending = [manifest.render]
    while (pending.length > 0) {
        const path = pending.pop() as string
        if (sources.includes(path)) continue
        sources.push(path)
        const text = await Bun.file(new URL(path, DOGFOOD)).text()
        for (const [, specifier] of text.matchAll(
            /from '#ui\/([^']+\.abide)'/g,
        ))
            pending.push(`src/ui/${specifier}`)
    }
    return sources
}
