// The client lane: the route table as static imports the bundler can see, then hydrate the slot the
// server rendered into.

import { navigate, outlet, ready, routes } from 'abide'
import { hydrate } from 'abide/ui'
import { record } from './bench.ts'

const CHROME = (): Promise<typeof import('./pages/layout.abide')> => import('./pages/layout.abide')

routes([
    { path: '/', page: () => import('./pages/page.abide'), layouts: [CHROME] },
    { path: '/complex', page: () => import('./pages/complex/page.abide'), layouts: [CHROME] },
])

await ready()

const root = document.querySelector('slot')
if (root !== null) {
    const started = performance.now()
    hydrate(root, outlet)
    record('hydrate', performance.now() - started)
}

document.addEventListener('click', (event) => {
    const link = (event.target as Element | null)?.closest?.('a[href^="/"]')
    if (link === null || link === undefined) return
    event.preventDefault()
    void navigate(link.getAttribute('href') as string)
})
