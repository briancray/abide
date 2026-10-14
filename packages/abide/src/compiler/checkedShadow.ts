import { SERVER_SPECIFIER } from '#shared/SPECIFIERS.ts'
import type { CheckerAnswer } from './CheckerAnswer.ts'
import type { Finding } from './Finding.ts'
import { hookCalls } from './hookCalls.ts'
import {
    CHECKED_CONFIG,
    CHECKED_CONFIG_OF,
    CHECKED_VALUES,
    CHECKED_WRITE,
    Lowering,
    type Routed,
} from './Lowering.ts'
import { holdsReactive } from './PositionTable.ts'
import type { AbideFile } from './parseAbide.ts'
import { NO_PROPS, type Origin, type Span } from './projectShadow.ts'
import { CHECKED_SUFFIX } from './ShadowMap.ts'
import { abideImports } from './splitImports.ts'

// 38.3 — A `.abide` FILE AS THE PROGRAM IT RUNS AS, for the checker to report on. The projection
// (`projectShadow`) is the file as WRITTEN, which is what the checker answers 31.3 about — and a
// name read by name is a `Reactive` there, so `count + 1` is an error in it that the author never
// made. This is the same text lowered the way the emitters lower it, so what the checker says
// about it is what it would say about the module that runs.
//
// TWO MAPS BACK TO THE SOURCE. `origins` places a run of this text in the projection, and the
// projection's own places that in the `.abide` (`ShadowMap` reads the two in turn).
//
// A `.abide` IMPORT NAMES ITS CHECKED MODULE, so a component a page imports resolves to something
// the checker can read rather than to a file it cannot parse. What a checked module exports as its
// default is a component taking what its `props` call declares, so a tag is held to it (38.40).

/** A `.abide` lowered as the program it runs as, with its runs mapped back to the projection. */
export type CheckedShadow = {
    text: string
    origins: Origin[]
    /** What the lowering refused, at projection offsets (`Lowering.refusals`). */
    refusals: Finding[]
}

/**
 * What a checked module's default export is declared as. Scaffolding, so a jump to it is a jump to
 * the component's file (`TypeSession.inspect`).
 */
export const COMPONENT_STAND_IN = '__component'

/**
 * The component a checked module exports as its default: called with the record its tag passes
 * (`projectShadow`'s `invocation`), and answering the `Component` a server module's call of it
 * renders (34.16). What its blocks export by name is beside it.
 */
function componentModule(props: string, generics?: string): string {
    // 34.13 — generic over what the file's `<script>` declares, so a caller's props infer it, the
    // signature's own parameters shadowing the opaque stand-ins the body was checked against. 34.16 —
    // a component no prop is required of is called with none, as the runtime's bound face takes it.
    const parameters = generics === undefined ? '' : `<${generics}>`
    return `
declare const ${COMPONENT_STAND_IN}: ${parameters}(...record: {} extends ${props} ? [record?: ${props}] : [record: ${props}]) => import('${SERVER_SPECIFIER}').Component
export default ${COMPONENT_STAND_IN}
`
}

/** A component nothing has lowered takes anything, which is no finding rather than a wrong one. */
export const COMPONENT_MODULE = componentModule('any')

/** The file lowered the way the emitters lower it, for the checker to report on. */
export function checkedShadow(
    file: AbideFile,
    answer: CheckerAnswer,
    /** 23.9 — a page's or a layout's route, which its `route.params` is typed by. */
    routed?: Routed,
): CheckedShadow {
    const lowering = new Lowering(file, answer, true, undefined, routed)
    const projection = lowering.projection
    // Every span the emitters lower, with whether it holds the `Reactive` rather than reading it.
    const units: { span: Span; holds: boolean }[] = [
        { span: projection.modules, holds: false },
        { span: projection.servers, holds: false },
        { span: projection.scripts, holds: false },
    ]
    for (const span of projection.slots.values())
        units.push({ span, holds: holdsReactive(span) })
    for (const span of projection.keys.values())
        units.push({ span, holds: false })
    // 32.34 — a tag choosing by a value is checked as the call on what it reads.
    for (const span of projection.tags.values())
        units.push({ span, holds: false })
    units.sort((one, two) => one.span.start - two.span.start)

    const source = projection.text
    const origins: Origin[] = []
    let text = ''
    let at = 0
    // Where the script blocks end in THIS text, which lowering has moved from where they end in
    // the projection.
    let scriptsEnd = 0
    for (const { span, holds } of units) {
        if (span.start < at) continue
        origins.push({ at: text.length, source: at, length: span.start - at })
        text += source.slice(at, span.start)
        text += lowering.lower(span, holds, origins, text.length)
        at = span.end
        if (span === projection.scripts) scriptsEnd = text.length
    }
    origins.push({ at: text.length, source: at, length: source.length - at })
    text += source.slice(at)
    text += componentModule(propsOf(lowering), file.generics)
    // What each name read by name holds when it is read: what calling it hands back, and through a
    // props accessor, what calling what that hands back does.
    let values = ''
    for (const [name, through] of lowering.values)
        values += `    ${name}: ${
            through
                ? `ReturnType<ReturnType<typeof ${name}>>`
                : `ReturnType<typeof ${name}>`
        }\n`
    text += `declare const ${CHECKED_VALUES}: {\n${values}}\n`
    text += `declare function ${CHECKED_WRITE}<Cell extends { (): unknown; set(value: never): unknown }, Value extends Parameters<Cell['set']>[0]>(cell: Cell, value: Value): Value extends ReturnType<Cell> ? Value : ReturnType<Cell>\n`
    text += configDeclarations(lowering)
    return {
        ...pointAtCheckedModules(text, origins, scriptsEnd),
        refusals: lowering.refusals,
    }
}

/**
 * The props type a caller is held to, spelled off the file's `props` call.
 *
 * 33.4 — WHAT THE CHILD DECLARES IS WHAT A CALLER IS HELD TO: the type `props<X>()` hands back, read
 * off the call as the author wrote it, which stands at the top of the module where this is
 * declared. 33.3 — `props()` with no argument hands back the untyped record, and takes anything.
 */
function propsOf(lowering: Lowering): string {
    const read = lowering.ownPropsRead()
    return read === undefined
        ? NO_PROPS
        : `ReturnType<typeof ${lowering.projection.text
              .slice(read.from, read.to)
              .replace(/\(\s*\)$/, '')}>`
}

/**
 * 27.13 — WHAT EACH `onConfig` DEFAULTS IS DECLARED INTO `Config`, so `config().RETRIES` is the
 * `number` its defaults return rather than the index's `unknown`. Each call is bound by the lowering
 * (`CHECKED_CONFIG`) and typed by `CHECKED_CONFIG_OF` as what its defaults return; an interface can
 * only extend a name, so each is aliased, and a union is narrowed to the keys every member has.
 * Nothing where the file files none.
 */
function configDeclarations(lowering: Lowering): string {
    const bound: string[] = []
    for (const read of lowering.answer.reads)
        if (read.shape === 'config')
            bound.push(`${CHECKED_CONFIG}${read.start}`)
    return configInterface(bound)
}

/** `Config` extended by what each of `bound` holds — the binding of one `onConfig` call each. */
function configInterface(bound: readonly string[]): string {
    if (bound.length === 0) return ''
    let aliases = ''
    let names = ''
    for (const name of bound) {
        aliases += `type ${name}Type = typeof ${name}\n`
        names += names === '' ? `${name}Type` : `, ${name}Type`
    }
    return `declare function ${CHECKED_CONFIG_OF}<Options>(on: (defaults: never, options?: Options) => () => void): <Defaults>(defaults: ((env: import('${SERVER_SPECIFIER}').Env) => Defaults) | null, options?: Options) => [Defaults] extends [object] ? Pick<Defaults, keyof Defaults> : {}
${aliases}declare module '${SERVER_SPECIFIER}' {
    interface Config extends ${names} {}
}
`
}

/**
 * 27.13 FOR A HANDLER FILE, the one module that is no `.abide` and may call a hook (37.13): its
 * text with each `onConfig(…)` standing as a statement at its top level bound as the lowering binds
 * a server block's, and `Config` extended by each, or `undefined` where it files none.
 *
 * A MODULE OF ITS OWN BESIDE THE FILE, which the checker reads and nothing reports on: the file's own
 * text is the one its diagnostics are placed in, and binding a call shifts every column after it.
 */
export function moduleConfigShadow(text: string): string | undefined {
    const bound: string[] = []
    let out = ''
    let from = 0
    for (const call of hookCalls(text)) {
        if (call.hook !== 'onConfig' || !call.topLevel) continue
        const name = `${CHECKED_CONFIG}${bound.length}`
        bound.push(name)
        out += `${text.slice(from, call.at)}const ${name} = ${CHECKED_CONFIG_OF}(${text.slice(call.at, call.end)})`
        from = call.end
    }
    if (bound.length === 0) return undefined
    return `${out}${text.slice(from)}\n${configInterface(bound)}`
}

/**
 * Points each `.abide` import in the script blocks at its checked module, and moves `origins` to
 * match.
 *
 * `from '…/Card.abide'` becomes `from '…/Card.abide.check.ts'` in the script blocks, which are all
 * that can import — and so does an `import('…/Card.abide')`, the same edge to the build (34.15),
 * read off the same scan (`abideImports`). Each insertion moves every run after it, and splits the
 * run it lands in.
 */
function pointAtCheckedModules(
    text: string,
    origins: Origin[],
    scriptsEnd: number,
): { text: string; origins: Origin[] } {
    const insertions: number[] = []
    for (const found of abideImports(text.slice(0, scriptsEnd)))
        insertions.push(found.closingQuote)
    if (insertions.length === 0) return { text, origins }

    let out = ''
    let from = 0
    for (const insertAt of insertions) {
        out += text.slice(from, insertAt) + CHECKED_SUFFIX
        from = insertAt
    }
    out += text.slice(from)

    const moved: Origin[] = []
    let passed = 0
    for (const origin of origins) {
        let { at, source, length } = origin
        // Every insertion strictly inside this run cuts it; the part before goes out at the shift
        // so far, and the rest carries on past the insertion.
        while (
            passed < insertions.length &&
            (insertions[passed] as number) <= at
        )
            passed += 1
        while (
            passed < insertions.length &&
            (insertions[passed] as number) < at + length
        ) {
            const cut = (insertions[passed] as number) - at
            moved.push({
                at: at + passed * CHECKED_SUFFIX.length,
                source,
                length: cut,
            })
            at += cut
            source += cut
            length -= cut
            passed += 1
        }
        moved.push({ at: at + passed * CHECKED_SUFFIX.length, source, length })
    }
    return { text: out, origins: moved }
}
