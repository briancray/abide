import { SyntaxKind } from 'typescript/unstable/ast'
import { isComponentTag } from './classifyTemplate.ts'
import type { AbideFile, InlineComponent } from './parseAbide.ts'
import { SHARED_SPECIFIER } from './SPECIFIERS.ts'
import { importDeclarations, importedNames } from './splitImports.ts'
import type { TemplateNode } from './TemplateNode.ts'
import { isContextualKeyword, tokenise } from './tokenise.ts'

// 32.39 — AN INLINE COMPONENT COMPILES AS THE FILE IT WOULD BE MOVED INTO. Each `{#component}` is
// handed to the build as a source of its own, beside the file that declares it — a sibling, so
// every relative import resolves from where the author wrote it — and the declaring file imports
// it as it would import that file. Everything downstream is the component-file path, unchanged:
// the checker types it through its own shadow, the graph marks it invoked, and both emitters write
// it a module of its own.
//
// 32.41, 32.42 — WHAT IT SEES IS WHAT THAT FILE WOULD: its props, its own `<script>`, the file's imports
// and the file's inline components, itself included. The file's `<script>` and `<script module>`
// are not copied, which is what stops a name declared there from reaching it.

/** Where an inline component was declared: its file, and the block's span in that file's text. */
export type InlineOf = { path: string; start: number; end: number }

/** The path the build files an inline component under, beside the file declaring it. */
export function inlinePath(path: string, name: string): string {
    return `${path}.${name}.abide`
}

/**
 * `sources` with each declaring file importing its inline components, and each one after it as a
 * source of its own.
 *
 * The component's source carries the declaring file's `text`, which is what every offset in it is
 * an offset into, and `inlineOf`, which says whose line a finding on it is.
 */
export function withInline<Source extends { path: string; file: AbideFile }>(
    sources: readonly Source[],
): (Source & { inlineOf?: InlineOf })[] {
    const expanded: (Source & { inlineOf?: InlineOf })[] = []
    for (const source of sources) {
        const file = source.file
        const components = file.components
        if (components.length === 0) {
            expanded.push(source)
            continue
        }
        const base = source.path.slice(source.path.lastIndexOf('/') + 1)
        // Each component's import, placed at its name: a finding about it is a finding about it.
        const imports: string[] = []
        const importsAt: number[] = []
        for (const component of components) {
            imports.push(
                `import ${component.name} from './${base}.${component.name}.abide'`,
            )
            importsAt.push(component.at)
        }
        expanded.push({
            ...source,
            file: {
                ...file,
                scripts: [...file.scripts, ...imports],
                origins: {
                    ...file.origins,
                    scripts: [...file.origins.scripts, ...importsAt],
                },
            },
        })

        // The file's imports, each placed where it was written, with the names it binds.
        const blocks = [...file.modules, ...file.scripts]
        const starts = [...file.origins.modules, ...file.origins.scripts]
        const declarations: { text: string; at: number; binds: string[] }[] = []
        for (let at = 0; at < blocks.length; at += 1)
            for (const declaration of importDeclarations(
                blocks[at] as string,
            )) {
                const binds: string[] = []
                for (const imported of importedNames(declaration.text))
                    binds.push(imported.name)
                declarations.push({
                    text: declaration.text,
                    at: (starts[at] as number) + declaration.start,
                    binds,
                })
            }

        for (const component of components) {
            // ONLY WHAT IT NAMES, as the file it would be moved into imports only what it uses: a
            // copy of every import is a module full of names nothing calls.
            const named = namesIn(component)
            const scripts: string[] = []
            const scriptsAt: number[] = []
            let bindsProps = false
            for (const declaration of declarations) {
                if (!declaration.binds.some((name) => named.has(name))) continue
                scripts.push(declaration.text)
                scriptsAt.push(declaration.at)
                bindsProps ||= declaration.binds.includes('props')
            }
            for (let at = 0; at < components.length; at += 1)
                if (named.has((components[at] as InlineComponent).name)) {
                    scripts.push(imports[at] as string)
                    scriptsAt.push(importsAt[at] as number)
                }
            // 32.40 — THE PATTERN IS A `props` CALL'S, and the annotation its type argument. The
            // pattern is placed where it was written, so a finding on a binding is on its line.
            if (component.pattern !== '') {
                if (!bindsProps) {
                    scripts.push(`import { props } from '${SHARED_SPECIFIER}'`)
                    scriptsAt.push(component.at)
                }
                const declared = `const ${component.pattern} = props`
                scriptsAt.push(component.patternAt - 'const '.length)
                if (component.type === '') scripts.push(`${declared}()`)
                else {
                    scripts.push(`${declared}<`, `${component.type}>()`)
                    scriptsAt.push(component.typeAt)
                }
            }
            if (component.setup !== null) {
                scripts.push(component.setup.text)
                scriptsAt.push(
                    file.origins.holders.get(component.setup) as number,
                )
            }
            expanded.push({
                ...source,
                path: inlinePath(source.path, component.name),
                file: {
                    scripts,
                    modules: [],
                    styles: [],
                    head: [],
                    template: component.children,
                    components: [],
                    origins: {
                        modules: [],
                        scripts: scriptsAt,
                        holders: file.origins.holders,
                        keys: file.origins.keys,
                    },
                },
                inlineOf: {
                    path: source.path,
                    start: component.start,
                    end: component.end,
                },
            })
        }
    }
    return expanded
}

/**
 * Every name an inline component's code spells: its pattern and annotation, its setup, and every
 * expression, subject, key and component tag its body holds.
 *
 * A name spelled is not a name read — a member or a key of the same spelling is counted too — so
 * this can only keep an import the component does not need, never drop one it does.
 */
function namesIn(component: InlineComponent): Set<string> {
    const code = [component.pattern, component.type]
    if (component.setup !== null) code.push(component.setup.text)
    const walk = (nodes: TemplateNode[]): void => {
        for (const node of nodes) {
            if (node.kind === 'text') continue
            if (node.kind === 'expression') {
                code.push(node.source)
                continue
            }
            if (node.kind === 'element') {
                if (isComponentTag(node.tag)) code.push(node.tag)
                for (const attribute of node.attributes)
                    if (attribute.expression) code.push(attribute.value)
                walk(node.children)
                continue
            }
            if (node.block === 'for') {
                code.push(node.subject, node.key)
                if (node.setup !== null) code.push(node.setup.text)
                walk(node.children)
                continue
            }
            for (const branch of node.branches) {
                code.push(branch.subject)
                if (branch.setup !== null) code.push(branch.setup.text)
                walk(branch.children)
            }
        }
    }
    walk(component.children)
    const names = new Set<string>()
    for (const text of code)
        for (const token of tokenise(text))
            if (
                token.kind === SyntaxKind.Identifier ||
                isContextualKeyword(token.kind)
            )
                names.add(token.text)
    return names
}
