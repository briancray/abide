import { lowerAsyncInterpolations } from './lowerAsyncInterpolations.ts'
import { lowerScript } from './lowerScript.ts'
import { parseTemplate } from './parseTemplate.ts'
import { scopeCss } from './scopeCss.ts'
import type { AnalyzedComponent } from './types/AnalyzedComponent.ts'
import type { InterpolationClassifier } from './types/InterpolationClassifier.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
The shared compile front-end: splits the leading `<script>` off the template,
desugars the signal surface to the doc form, lowers the script's data access, and
parses the template (which keeps each `<style>` as an in-place node). Each `<style>`
is scoped to its own attribute (`data-a-<hash>`); `annotateScopes` stamps that
attribute onto every element in the style's sibling subtree, so a top-level
`<style>` covers the whole component while a nested one covers only the branch it
sits in. Both client and SSR back-ends read the per-element `scopes`, so the targets
always agree.

`scopeSeed` (the component's stable module id, supplied by the loader) seeds each
hash — combined with the style's source-order index — so the attribute tracks
component+position identity, not CSS text: an edit to a `<style>` keeps the same
`data-a-…`, so the live elements still match and the CSS can hot-swap in place.
Absent (direct compile calls / tests) it falls back to hashing the style body.
*/
export function analyzeComponent(
    source: string,
    scopeSeed?: string,
    classify?: InterpolationClassifier,
): AnalyzedComponent {
    /* Only the LEADING `<script>` is the component script; scripts nested in the
       template (scoped reactive blocks) survive into the parsed nodes. The `<style>`
       is left in the template for the parser to extract structurally (below), so a
       `<style>` quoted inside an expression is never mistaken for the component's. */
    const scriptMatch = source.match(/^\s*<script[^>]*>([\s\S]*?)<\/script>/)
    const scriptBody = (scriptMatch?.[1] ?? '').trim()
    const afterScript = scriptMatch ? source.slice(scriptMatch[0].length) : source
    const template = afterScript.trim()
    /* Absolute source offset of the trimmed template's first char (script length + the
       remainder's leading whitespace). Passed as the parse base so each interpolation's
       `loc` is an offset into the ORIGINAL source — the coordinate the shadow's
       source→shadow `mappings` use, so a type-directed classifier resolves against it.
       The runtime back-ends ignore `loc`, so this only affects the classifier's lookup. */
    const templateBase =
        (scriptMatch ? scriptMatch[0].length : 0) +
        (afterScript.length - afterScript.trimStart().length)

    /* Parse the template first so the nested branch `<script>`s are in hand before the
       leading script lowers: their raw code feeds the dead-import usage check, keeping a
       reactive import (`state`) alive when only a nested branch uses it (its
       `state.computed(...)` stays literal, unlike the desugared leading script). */
    const parsed = parseTemplate(template, templateBase)
    /* Type-directed interpolation lowering (ADR-0019): when the build supplies a
       classifier, rewrite each promise-typed text interpolation into a streaming await
       block BEFORE the script lowers and scopes annotate — the synthesized await node then
       flows through the same back-ends as an explicit `{#await}`. Without a classifier the
       template is returned untouched, so the default path is exactly today's behavior. */
    const nodes =
        classify === undefined ? parsed.nodes : lowerAsyncInterpolations(parsed.nodes, classify)
    const nestedScriptCode = collectNestedScriptCode(nodes)
    /* `lowerScript` parses the script ONCE and chains signal desugaring, reference
       renaming, and doc-access lowering over that single tree, then hoists top-level
       imports off the tree structurally — imports live at module scope, not inside the
       mount/render function the body becomes. It returns the collected signal name sets. */
    const {
        body: script,
        ssrBody: ssrScript,
        imports,
        stateNames,
        derivedNames,
        computedNames,
        cellReadNames,
        droppedReactiveImports,
    } = lowerScript(scriptBody, nestedScriptCode)
    /* `annotateScopes` mutates the tree — assigning each style its scope attribute and
       stamping covered elements — and returns the scoped CSS per block for the bundler. */
    const styles = annotateScopes(nodes, [], scopeSeed, { count: 0 })
    return {
        script,
        ssrScript,
        imports,
        droppedReactiveImports,
        stateNames,
        derivedNames,
        computedNames,
        cellReadNames,
        nodes,
        styles,
        /* Hydration adopts every block in place — including `await`, which resumes
           from the streamed value in the resume manifest (see `runtime/RESUME`). */
        hydratable: true,
    }
}

/* The children of a control-flow / element / component node, or undefined for a
   leaf (text/script/style). Every children-bearing kind carries `children`. */
function childrenOf(node: TemplateNode): TemplateNode[] | undefined {
    return 'children' in node ? node.children : undefined
}

/* The concatenated source of every nested `<script>` anywhere in the tree — the branch-local
   reactive blocks. Used only to keep the leading script's reactive imports alive when a nested
   branch is their sole consumer; the raw text is enough to spot the identifier reference. */
function collectNestedScriptCode(nodes: TemplateNode[]): string {
    let code = ''
    for (const node of nodes) {
        if (node.kind === 'script') {
            code += `\n${node.code}`
        }
        const children = childrenOf(node)
        if (children !== undefined) {
            code += collectNestedScriptCode(children)
        }
    }
    return code
}

/*
Walks `nodes` in source order, scoping each `<style>` to its sibling subtree: a
style among a sibling list covers every element in that list AND every descendant
(so its attribute reaches the whole branch it sits in, like the nested-`<script>`
rule). `inherited` is the scope attributes already active from ancestors; this
level adds its own styles' attributes, stamps the resulting set onto each element
here, and recurses with it. `index.count` is the running source-order ordinal that
(with `scopeSeed`) keeps each attribute stable across CSS edits. Returns the scoped
CSS for every non-empty style, in source order, for the bundler to concatenate.
*/
function annotateScopes(
    nodes: TemplateNode[],
    inherited: string[],
    scopeSeed: string | undefined,
    index: { count: number },
): { attribute: string; css: string }[] {
    const collected: { attribute: string; css: string }[] = []
    /* This sibling list's own style attributes — active for every element here. */
    const here = [...inherited]
    for (const node of nodes) {
        if (node.kind === 'style' && node.css.trim() !== '') {
            const attribute = `data-a-${hashString(`${scopeSeed ?? node.css}#${index.count}`)}`
            index.count += 1
            collected.push({ attribute, css: scopeCss(node.css, attribute) })
            here.push(attribute)
        }
    }
    for (const node of nodes) {
        if (node.kind === 'element') {
            node.scopes = here
        }
        const children = childrenOf(node)
        if (children !== undefined) {
            collected.push(...annotateScopes(children, here, scopeSeed, index))
        }
    }
    return collected
}

/* Small stable hash (djb2 → base36) for a per-style scope attribute. */
function hashString(value: string): string {
    let hash = 5381
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 33) ^ value.charCodeAt(index)
    }
    return (hash >>> 0).toString(36)
}
