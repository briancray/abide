// 38.12 — A PAGE CHECKED UNDER A LINKED ROOT, as an editor opens a workspace reached through a
// symlink (`/tmp` is one on macOS). The resolver names a component by its REAL path and the page stays
// under the link, so the component's shadow was written where the page's import never looks, and
// the checker answered it with the stand-in that takes anything.
//
// A FILE OF ITS OWN because the miss shows on the first check a process makes: a checker opened
// after another in the same process has answered the page's import with the component's props
// either way, and so cannot tell the fix from its revert.

import { symlinkSync, unlinkSync } from 'node:fs' // bun exposes no symlink of its own
import { afterAll, expect, test } from 'bun:test'
import { checkSource } from '#compiler/checkApp.ts'
import { openChecker } from '#compiler/compileApp.ts'
import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

afterAll(() => removeTemporaryModules())

const PAGE = `<script>
import Card from '../components/Card.abide'
</script>
<Card title={1}/>`

// THE REVERT: drop the `linkedRoot` mapping in `checkSource`; `title` takes anything and nothing is
// reported.
test('a page checked through a symlinked root is held to its component props', async () => {
    const app = appFixture({
        'ui/pages/page.abide': PAGE,
        'ui/components/Card.abide': `<script>
import { props } from '@abide/abide'
const { title } = props<{ title: string }>()
</script>
<p>{title}</p>`,
    })
    const linked = `${app}-linked`
    symlinkSync(app, linked)
    const checker = await openChecker(linked)
    try {
        const found = await checkSource(
            checker,
            linked,
            `${linked}/ui/pages/page.abide`,
            PAGE,
        )
        expect(found.map((diagnosis) => diagnosis.code)).toEqual([2322])
    } finally {
        await checker.close()
        unlinkSync(linked)
    }
}, 60_000)
