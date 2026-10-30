// 16.2 — A HANDLER FILE IS ONE MODULE HOWEVER ITS IMPORT IS SPELLED: the server mounts one, so a
// second copy has no address and throws when called. Served at run time, bun asks a plugin's
// `onResolve` only for a specifier with an extension, so an extensionless one never reached the
// redirect to the handler's face, and the runtime no longer redirects at resolve at all.
//
// NO EXTENSIONLESS `#src` SPELLING: bun reads `#src/media/getGrid.handler` against the first target of
// `"#src/*": ["./*", "./*.ts"]` as a file with an extension and never tries the second, where
// `#src/media/getGrid` reached `.ts` by bun's extension probing alone. A relative extensionless import
// still probes.

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
        'media/getGrid.handler.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(() => 42)\n`,
        'lib/spellings.ts': `import withExtension from '#src/media/getGrid.handler.ts'
import withoutExtension from '../media/getGrid.handler'
import relative from '../media/getGrid.handler.ts'

export { relative, withExtension, withoutExtension }
`,
    })
    serveCompilation(dir, {
        files: {},
        handlers: {
            'media/getGrid.handler.ts': {
                scope: '/media',
                client: '',
                args: undefined,
            },
        },
        tables: {},
    })
    const spellings = await import(`${dir}/lib/spellings.ts`)
    const mounted = await import(`${dir}/media/getGrid.handler.ts${HANDLER_SUFFIX}`)
    expect(spellings.withExtension).toBe(mounted.default)
    expect(spellings.withoutExtension).toBe(mounted.default)
    expect(spellings.relative).toBe(mounted.default)
})
