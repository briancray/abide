// 11.32 THROUGH A SERVED APP. `scope.test.ts` gates the mechanism in one process; this is the
// claim a host depends on: a value an app's module builds at import is one value per REQUEST, so
// what one reader's page wrote is not what the next reader's page renders. Spawned rather than
// served in here for `serve.test.ts`'s reason — happy-dom's preload clobbers `Response`.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// THE PAGE WRITES DURING ITS OWN RENDER, which is the one write a request makes that nothing else
// can explain: with the value process-wide, the second request starts from the first one's count.
const PAGE = `<script>
import { visits } from '#src/ui/visits.ts'

visits.set(visits() + 1)
</script>

<main><p id="visits">{visits()}</p></main>`

let stop = (): void => {}
let base = ''

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'page.abide': PAGE,
        'ui/visits.ts': `import { reactive } from '@abide/abide'\n\nexport const visits = reactive(0)\n`,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// THE REVERT: render with `render(bound, …)` in `answerRequest` rather than through
// `inScopeEachPull`; the page runs in no request, reaches the value built at import, and the
// third request renders 3 where 1 is due.
test('a module-level value is one value per request, on the served app — 11.32', async () => {
    const rendered: string[] = []
    for (let visit = 0; visit < 3; visit += 1) {
        const html = await (await Bun.fetch(`${base}/`)).text()
        rendered.push(/<p id="visits">(\d+)<\/p>/.exec(html)?.[1] ?? html)
    }
    expect(rendered).toEqual(['1', '1', '1'])
})
