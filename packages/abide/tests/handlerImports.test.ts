// 16.2 — A HANDLER FILE IS ONE MODULE HOWEVER ITS IMPORT IS SPELLED: the server mounts one, so a
// second copy has no address and throws when called. Served at run time, bun asks a plugin's
// `onResolve` only for a specifier with an extension, so an extensionless one never reached the
// redirect to the handler's face, and the runtime no longer redirects at resolve at all.

import { afterAll, expect, test } from 'bun:test'
import { serveCompilation } from '#server/abideModules.ts'
import { HANDLER_SUFFIX } from '#server/MODULE_QUERIES.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

// THE REVERT: drop `handlerFilesPlugin` from `serveCompilation`; every spelling loads the raw file,
// which is not the face the server mounts, and all three comparisons are false.
test('every spelling of a handler file import is the face the server mounts — 16.2', async () => {
    const dir = temporaryModule({
        'package.json': JSON.stringify({
            name: 'spellings',
            type: 'module',
            imports: { '#src/*': ['./*', './*.ts'] },
        }),
        'media/getGrid.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(() => 42)\n`,
        'lib/spellings.ts': `import withExtension from '#src/media/getGrid.ts'
import withoutExtension from '#src/media/getGrid'
import relative from '../media/getGrid'

export { relative, withExtension, withoutExtension }
`,
    })
    serveCompilation(dir, {
        files: {},
        handlers: { 'media/getGrid.ts': { scope: '/media', client: '' } },
        tables: {},
        mounted: {},
    })
    const spellings = await import(`${dir}/lib/spellings.ts`)
    const mounted = await import(`${dir}/media/getGrid.ts${HANDLER_SUFFIX}`)
    expect(spellings.withExtension).toBe(mounted.default)
    expect(spellings.withoutExtension).toBe(mounted.default)
    expect(spellings.relative).toBe(mounted.default)
})
