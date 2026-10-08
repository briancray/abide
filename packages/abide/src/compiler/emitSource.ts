import { fileKind } from '#shared/routePattern.ts'
import type { CheckerAnswer } from './CheckerAnswer.ts'
import { emitClient } from './emitClient.ts'
import { emitComponent } from './emitComponent.ts'
import type { AbideFile } from './parseAbide.ts'
import {
    markScoped,
    namesViewTransition,
    scopeCss,
    scopeToken,
} from './scopeStyles.ts'

/**
 * One `.abide`'s modules, in the mode the build compiles it in: its server module, its client
 * module (`''` where it has none) and its scoped stylesheet.
 *
 * Everything that mode depends on is the path below the app root and whether another file invokes
 * it (`componentGraph`), so a test handing over the same two facts compiles what the build would.
 */
export function emitSource(
    relative: string,
    file: AbideFile,
    answer: CheckerAnswer,
    invoked: boolean,
    landed?: ReadonlyMap<string, string>,
): {
    server: string
    client: string
    sheet: string | undefined
    /** 39.8 — whether a `<style>` names a view transition, read here rather than at run time. */
    transitions: boolean
} {
    const kind = fileKind(relative)
    // 34.4 — A COMPONENT WITH STYLES: its elements carry its token, and the styles, scoped,
    // are a stylesheet its client module imports — which the bundle collects into the
    // stylesheet the document links (38.24).
    // 34.11 — each body's own `<style>`, scoped to the token its elements carry; the
    // component's token is added only where a component-level `<style>` requires it.
    const token = scopeToken(relative)
    const componentStyled = file.styles.length > 0
    const bodies = markScoped(
        file.template,
        token,
        componentStyled ? [token] : [],
        [],
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
    const routed = kind === 'page' || kind === 'layout'
    // The client module is emitted only where there is something to hydrate, or where something
    // fills or imports it by name (`emitClient` answers which). A static component nothing invokes
    // has no `.client.ts`, so a file shipping no runtime is a fact about the build rather than a
    // claim about the bundler.
    const client = emitClient(
        file,
        answer,
        invoked ? (routed ? 'both' : 'invoked') : routed ? 'routed' : 'none',
        landed,
    )
    const name = relative.slice(relative.lastIndexOf('/') + 1)
    return {
        // 41.19 — a page and a layout are built a level at a time by `render`.
        server: emitComponent(file, answer, kind !== 'component', landed),
        client:
            client !== '' && sheet !== undefined
                ? `import './${name.replace(/\.abide$/, '.style.css')}'\n${client}`
                : client,
        sheet,
        transitions,
    }
}
