import { STYLE_QUERY } from '#server/MODULE_QUERIES.ts'
import type { JsonValue } from '#shared/JsonValue.ts'
import type { Placement } from '#server/placement.ts'
import type { CheckerAnswer } from './CheckerAnswer.ts'
import { emitClient } from './emitClient.ts'
import { emitComponent } from './emitComponent.ts'
import type { LoweredChunk } from './Lowering.ts'
import type { AbideFile } from './parseAbide.ts'
import { projectShadow } from './projectShadow.ts'
import {
    markScoped,
    namesViewTransition,
    scopeCss,
    scopeToken,
} from './scopeStyles.ts'
import { sourceMapOf } from './sourceMapOf.ts'

/**
 * One `.abide`'s modules, in the mode the build compiles it in: its server module, its client
 * module (`''` where it has none) and its scoped stylesheet.
 *
 * Everything that mode depends on is where the file is placed (`placement`) and whether another
 * file invokes it (`componentGraph`), so a test handing over the same facts compiles what the build
 * would.
 */
export function emitSource(
    source: Pick<Placement, 'relative' | 'kind' | 'scope'> & {
        file: AbideFile
        answer: CheckerAnswer
        invoked: boolean
    },
    /**
     * 16.28 — what the browser's module binds in place of the server block: the wrapper of each
     * private handler it declares, under the handler's name (`standInsOf`).
     */
    standIns = '',
    /** 38.97 — the `.abide`'s text, where the build wants each module's source map. */
    text?: string,
    /** 19.9 — the schema each private handler it declares derives off its annotation, by name. */
    derived?: Readonly<Record<string, JsonValue>>,
): {
    server: string
    client: string
    /** 38.97 — each module's `mappings` into the `.abide`, where `text` was given. */
    serverMappings: string | undefined
    clientMappings: string | undefined
    sheet: string | undefined
    /** 39.8 — whether a `<style>` names a view transition, read here rather than at run time. */
    transitions: boolean
} {
    const { relative, kind, file, answer, invoked } = source
    // 34.4 — A COMPONENT WITH STYLES: its elements carry its token, and the styles, scoped,
    // are a stylesheet its client module imports — which the bundle collects into the
    // stylesheet the document links (38.23).
    // 34.11 — each body's own `<style>`, scoped to the token its elements carry; the
    // component's token is added only where a component-level `<style>` requires it.
    const token = scopeToken(relative)
    const componentStyled = file.styles.length > 0
    const bodies = markScoped(
        file.template,
        token,
        componentStyled ? [token] : [],
        file.components,
    )
    let sheet: string | undefined
    let transitions = false
    if (componentStyled || bodies.length > 0) {
        const styles = file.styles.join('\n')
        sheet = scopeCss(styles, token)
        transitions = namesViewTransition(styles)
        for (const body of bodies) {
            sheet += `\n${scopeCss(body.css, body.token)}`
            transitions ||= namesViewTransition(body.css)
        }
    }
    // 30.7 — A ROUTABLE PAGE CARRIES ITS OWN MARKUP for the same reason an invoked component
    // does, and it is the same mechanism: a page the reader ARRIVED at was painted by the
    // server and hydrates, and a page they NAVIGATED to is handed the empty anchor pair and
    // fills it from the template in its own module. `emitClient`'s `fillEmpty` is
    // what makes one module serve both, so "routable" joins "invoked" as a module that fills
    // itself — and parts from it in how OFTEN it can be filled, which is what decides whether
    // the fill is markup or a build, and in carrying a head (`SelfFill`).
    // 35.1 — A LAYOUT CARRIES ITS OWN MARKUP for the same reason a routable page does:
    // nothing imports it, the router is what invokes it, and a reader who navigated to a
    // page under it may arrive with the layout already standing or with nothing at all.
    // An `error.abide` is never navigated to — only the server holds the error table.
    const selfFilled = kind === 'page' || kind === 'layout'
    // The client module is emitted only where there is something to hydrate, or where something
    // fills or imports it by name (`emitClient` answers which). A static component nothing invokes
    // has no `.client.ts`, so a file shipping no runtime is a fact about the build rather than a
    // claim about the bundler.
    const serverChunks: LoweredChunk[] | undefined =
        text === undefined ? undefined : []
    const clientChunks: LoweredChunk[] | undefined =
        text === undefined ? undefined : []
    const client = emitClient(
        file,
        answer,
        invoked
            ? selfFilled
                ? 'both'
                : 'invoked'
            : selfFilled
              ? 'routed'
              : 'none',
        clientChunks,
    )
    // 41.19 — a page and a layout are built a level at a time by `render`.
    const server = emitComponent(
        file,
        answer,
        kind !== 'component',
        source.scope,
        serverChunks,
        derived,
    )
    const name = relative.slice(relative.lastIndexOf('/') + 1)
    const browser = withStandIns(
        client !== '' && sheet !== undefined
            ? `import './${name}${STYLE_QUERY}'\n${client}`
            : client,
        standIns,
    )
    let mapped: Mapped | undefined
    if (text !== undefined) {
        mapped = MAPPED.get(relative)
        if (
            mapped === undefined ||
            mapped.source !== text ||
            mapped.server !== server ||
            mapped.client !== browser
        ) {
            const projected = projectShadow(file).origins
            mapped = {
                source: text,
                server,
                client: browser,
                serverMappings: sourceMapOf(
                    server,
                    serverChunks ?? [],
                    projected,
                    text,
                ),
                clientMappings:
                    browser === ''
                        ? undefined
                        : sourceMapOf(
                              browser,
                              clientChunks ?? [],
                              projected,
                              text,
                          ),
            }
            MAPPED.set(relative, mapped)
        }
    }
    return {
        server,
        client: browser,
        serverMappings: mapped?.serverMappings,
        clientMappings: mapped?.clientMappings,
        sheet,
        transitions,
    }
}

type Mapped = {
    source: string
    server: string
    client: string
    serverMappings: string
    clientMappings: string | undefined
}

// THE LAST MAPS PER FILE, for a process that compiles again (`abide dev`, the language server): a
// module's maps are a function of its text and the `.abide`'s, and a save changes one file. Reused
// only where all three texts match, so two apps in one process sharing a path cannot cross.
const MAPPED = new Map<string, Mapped>()

/** The browser's module with each private handler's wrapper after it. */
function withStandIns(client: string, standIns: string): string {
    if (standIns === '') return client
    return client === '' ? standIns : `${client}\n${standIns}`
}
