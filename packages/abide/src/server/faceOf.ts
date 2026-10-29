// WHICH FACE AN IMPORT OF THE APP'S IS ANSWERED WITH — one decision, of the file an import resolved
// to, the importer asking and the lane it is asked in, and nothing of bun's: `abideModules` is the
// adapter that hands bun's hooks to it, because bun decides which hook asks (an `onResolve` for a
// specifier, an `onLoad` for a path), and this decides what the answer is.

import type { JsonValue } from '#shared/JsonValue.ts'
import { HANDLER_SUFFIX, SERVER_QUERY } from './MODULE_QUERIES.ts'

// A VIRTUAL FACE'S PATH: its file's, with a suffix that is not a query. Both registries key a module
// by its path whatever its namespace, and the runtime's drops a query from it — so a file's text, its
// stylesheet or its bound face under `?…` took the place of the module the file compiles to.
export const BOUND = '::bound'
export const CLIENT = '::client'
export const TEXT = '::text'
export const STYLE = '::style'

/** The namespace a bundle's component module is answered in, at its file's own path. */
export const COMPONENT_NAMESPACE = 'abide-component'
/** The namespaces a file's text and a component's stylesheet are loaded in. */
export const TEXT_NAMESPACE = 'abide-text'
export const STYLE_NAMESPACE = 'abide-style'
/** The namespaces a browser module asked for outside a bundle, and a bound face, are loaded in. */
export const CLIENT_NAMESPACE = 'abide-client'
export const BOUND_NAMESPACE = 'abide-bound'

/**
 * Where an import is asked: in a bundle or by the runtime, and for a browser or a server. The runtime
 * is never a browser's, save for what a browser module it was asked for imports (`CLIENT`).
 */
export type Lane = { bundling: boolean; browser: boolean }

/** What a resolve answers an import with: the face's path, and the namespace it loads in. */
export type Face = { path: string; namespace: string }

/**
 * What an import asks of a file, by its spelling: its text (`?text`), a component's stylesheet
 * (`?style`), the module it compiles to (`?component`), its browser module (`?client`), its server
 * module (`?server`), a `.abide` named bare, or a module that may be a handler file.
 */
export type Asked =
    | 'text'
    | 'style'
    | 'component'
    | 'client'
    | 'server'
    | 'abide'
    | 'handler'

/**
 * One handler file, as `Compilation.handlers` holds it — and 19.9's schema its default's annotation
 * derives, which the module at the file's path holds it to (`derivedArgs`).
 */
export type HandlerFace = {
    scope: string
    client: string
    args: JsonValue | undefined
}

/**
 * The face an import of `file` is answered with, asked `asked` from `importer` in `lane` — or
 * `undefined` where the file is no face of abide's and bun's own resolve answers, or the refusal.
 *
 * `importer` is the path the importer is named by, its face's suffix kept: a browser module the
 * runtime was asked for (`CLIENT`) imports in a browser's lane, and a bound face (`BOUND`) imports the
 * component it binds.
 *
 * - 34.21 — a file's text, and 34.4 — a component's stylesheet, each at a path of its own, since a
 *   file is often imported as code and as text at once;
 * - 32.17 — the module a `.abide` compiles to: in a browser's lane its browser module, else its
 *   server module — in a namespace of its own in a bundle, where bun refuses a `file` path with `..`
 *   in it, which a `[...rest]` directory writes (23.5);
 * - 38.121 — its server module, to a browser module outside a bundle binding its private handlers,
 *   and never in a browser's lane (16.28);
 * - 34.16 — a `.abide` named bare is a module abide did not compile asking: on a server its bound
 *   face, and in a browser the component module itself;
 * - 16.2, 16.74 — a handler file, however its import is spelled and whoever imports it — the app or a
 *   package whose directory the app mounts (23.19) — is the one face the server mounts, and in a
 *   browser the wrapper; 20.4 — one withholding itself from the browser is no browser import.
 */
export function faceOf(
    asked: Asked,
    file: string,
    importer: string,
    lane: Lane,
    handlers: ReadonlyMap<string, HandlerFace>,
): Face | Error | undefined {
    const inBrowser = lane.browser || importer.endsWith(CLIENT)
    const component = (): Face =>
        inBrowser && !lane.browser
            ? { path: `${file}${CLIENT}`, namespace: CLIENT_NAMESPACE }
            : { path: file, namespace: componentNamespaceOf(lane) }
    switch (asked) {
        case 'text':
            return { path: `${file}${TEXT}`, namespace: TEXT_NAMESPACE }
        case 'style':
            return { path: `${file}${STYLE}`, namespace: STYLE_NAMESPACE }
        case 'component':
            return component()
        case 'client':
            return lane.browser
                ? { path: file, namespace: COMPONENT_NAMESPACE }
                : { path: `${file}${CLIENT}`, namespace: CLIENT_NAMESPACE }
        case 'server':
            return lane.browser
                ? new Error(
                      `abide: ${realFileOf(importer)} imports ${file}${SERVER_QUERY}, the server module, into the browser. Call its handlers by name. RULEBOOK 16.28.`,
                  )
                : { path: file, namespace: componentNamespaceOf(lane) }
        case 'abide':
            return inBrowser || importer === `${file}${BOUND}`
                ? component()
                : { path: `${file}${BOUND}`, namespace: BOUND_NAMESPACE }
        case 'handler': {
            const face = handlers.get(file)
            if (face === undefined) return undefined
            if (inBrowser && face.client === '')
                return new Error(
                    `abide: ${realFileOf(importer)} imports ${file}, whose handler withholds itself from the browser (\`clients: { ui: false }\`). Call it from a <script server>, or let the browser have it. RULEBOOK 20.4.`,
                )
            return { path: `${file}${HANDLER_SUFFIX}`, namespace: 'file' }
        }
    }
}

/** The namespace a component's own module loads in: abide's in a bundle, bun's own outside one. */
export function componentNamespaceOf(lane: Lane): string {
    return lane.bundling ? COMPONENT_NAMESPACE : 'file'
}

/** The file a face's path stands for: the path with its face's suffix taken off, or as given. */
export function realFileOf(path: string): string {
    for (const suffix of FACE_SUFFIXES)
        if (path.endsWith(suffix)) return path.slice(0, -suffix.length)
    return path
}

const FACE_SUFFIXES = [BOUND, CLIENT, TEXT, STYLE, HANDLER_SUFFIX]
