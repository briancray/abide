// 16.2, 16.74, 20.4, 32.17, 34.4, 34.16, 34.21, 38.121 — WHICH FACE AN IMPORT IS ANSWERED WITH, as one table of
// lane by ask by importer against the one function that decides it (`faceOf`), with no bundle built:
// `handlerImports.test.ts` and `mounts.test.ts` are where bun's hooks are seen to hand it the ask.

import { expect, test } from 'bun:test'
import {
    BOUND,
    BOUND_NAMESPACE,
    CLIENT,
    CLIENT_NAMESPACE,
    COMPONENT_NAMESPACE,
    type Face,
    faceOf,
    type Lane,
    realFileOf,
    STYLE,
    STYLE_NAMESPACE,
    TEXT,
    TEXT_NAMESPACE,
} from '#server/faceOf.ts'
import { HANDLER_SUFFIX } from '#server/MODULE_QUERIES.ts'

const RUNTIME: Lane = { bundling: false, browser: false }
const SERVER_BUNDLE: Lane = { bundling: true, browser: false }
const BROWSER_BUNDLE: Lane = { bundling: true, browser: true }

const CARD = '/app/lib/Card.abide'
const PAGE = '/app/index.abide'
const GRID = '/app/media/getGrid.ts'
const STAFF = '/app/staff/internal.ts'
const MOUNTED = '/app/node_modules/kit/admin/users/list.ts'
const HANDLERS = new Map([
    [
        GRID,
        {
            scope: '/media/getGrid',
            client: 'export default __wire()',
            args: undefined,
        },
    ],
    [STAFF, { scope: '/staff/internal', client: '', args: undefined }],
    [
        MOUNTED,
        {
            scope: '/tools/users/list',
            client: 'export default __wire()',
            args: undefined,
        },
    ],
])

function face(
    asked: Parameters<typeof faceOf>[0],
    file: string,
    importer: string,
    lane: Lane,
): Face | string | undefined {
    const answered = faceOf(asked, file, importer, lane, HANDLERS)
    return answered instanceof Error ? answered.message : answered
}

// THE REVERT: read the lane off `lane.browser` alone in `faceOf`, dropping the `CLIENT` importer; a
// browser module the runtime was asked for imports the server module, and its row reads `file`.
test('a .abide asked for its compiled module answers in its importer’s lane — 32.17', () => {
    expect(face('component', CARD, PAGE, RUNTIME)).toEqual({
        path: CARD,
        namespace: 'file',
    })
    expect(face('component', CARD, PAGE, SERVER_BUNDLE)).toEqual({
        path: CARD,
        namespace: COMPONENT_NAMESPACE,
    })
    expect(face('component', CARD, PAGE, BROWSER_BUNDLE)).toEqual({
        path: CARD,
        namespace: COMPONENT_NAMESPACE,
    })
    expect(face('component', CARD, `${PAGE}${CLIENT}`, RUNTIME)).toEqual({
        path: `${CARD}${CLIENT}`,
        namespace: CLIENT_NAMESPACE,
    })
    expect(face('client', CARD, PAGE, RUNTIME)).toEqual({
        path: `${CARD}${CLIENT}`,
        namespace: CLIENT_NAMESPACE,
    })
    expect(face('client', CARD, PAGE, BROWSER_BUNDLE)).toEqual({
        path: CARD,
        namespace: COMPONENT_NAMESPACE,
    })
})

// THE REVERT: answer `server` as `component` is answered; the browser module the runtime was asked for
// binds its private handlers from itself, and its row reads `Card.abide::client`.
test('a .abide asked for its server module answers it to a server and refuses a browser — 38.121, 16.28', () => {
    expect(face('server', CARD, `${CARD}${CLIENT}`, RUNTIME)).toEqual({
        path: CARD,
        namespace: 'file',
    })
    expect(face('server', CARD, `${CARD}${CLIENT}`, SERVER_BUNDLE)).toEqual({
        path: CARD,
        namespace: COMPONENT_NAMESPACE,
    })
    expect(face('server', CARD, PAGE, BROWSER_BUNDLE)).toContain(
        'RULEBOOK 16.28',
    )
})

// THE REVERT: answer a bare `.abide` with its component module from the bound face's own import too;
// the face imports itself, and the row reads the bound face where the component is due.
test('a .abide named bare is the bound face on a server and the component in a browser — 34.16', () => {
    expect(face('abide', CARD, '/app/lib/use.ts', RUNTIME)).toEqual({
        path: `${CARD}${BOUND}`,
        namespace: BOUND_NAMESPACE,
    })
    expect(face('abide', CARD, `${CARD}${BOUND}`, RUNTIME)).toEqual({
        path: CARD,
        namespace: 'file',
    })
    expect(face('abide', CARD, '/app/lib/use.ts', BROWSER_BUNDLE)).toEqual({
        path: CARD,
        namespace: COMPONENT_NAMESPACE,
    })
})

test('a text import and a stylesheet each answer at a path of their own — 34.21, 34.4', () => {
    for (const lane of [RUNTIME, SERVER_BUNDLE, BROWSER_BUNDLE]) {
        expect(face('text', CARD, PAGE, lane)).toEqual({
            path: `${CARD}${TEXT}`,
            namespace: TEXT_NAMESPACE,
        })
        expect(face('style', CARD, PAGE, lane)).toEqual({
            path: `${CARD}${STYLE}`,
            namespace: STYLE_NAMESPACE,
        })
    }
})

// 16.74, 23.19 — THE REVERT: answer `undefined` for an importer under `node_modules`; the mounted
// package's own page imports its handler file raw, and the row reads `undefined` where the face is due.
test('a handler file is its face whoever imports it, and no browser import where withheld — 16.74, 20.4', () => {
    for (const lane of [RUNTIME, SERVER_BUNDLE, BROWSER_BUNDLE])
        for (const importer of [
            PAGE,
            '/app/lib/spellings.ts',
            '/app/node_modules/kit/admin/index.abide',
        ])
            expect(face('handler', MOUNTED, importer, lane)).toEqual({
                path: `${MOUNTED}${HANDLER_SUFFIX}`,
                namespace: 'file',
            })
    expect(face('handler', '/app/lib/plain.ts', PAGE, BROWSER_BUNDLE)).toBe(
        undefined,
    )
    expect(face('handler', STAFF, PAGE, SERVER_BUNDLE)).toEqual({
        path: `${STAFF}${HANDLER_SUFFIX}`,
        namespace: 'file',
    })
    expect(face('handler', STAFF, PAGE, BROWSER_BUNDLE)).toContain(
        'RULEBOOK 20.4',
    )
    expect(face('handler', STAFF, `${PAGE}${CLIENT}`, RUNTIME)).toContain(
        'RULEBOOK 20.4',
    )
})

// 16.29 — THE REVERT: drop `HANDLER_SUFFIX` from the suffixes `realFileOf` takes off; the fence reads a
// handler face's path as a file of that name, and the row keeps the suffix.
test('a face’s path names the file it stands for — 16.29', () => {
    for (const suffix of [BOUND, CLIENT, TEXT, STYLE, HANDLER_SUFFIX])
        expect(realFileOf(`${CARD}${suffix}`)).toBe(CARD)
    expect(realFileOf(CARD)).toBe(CARD)
})
