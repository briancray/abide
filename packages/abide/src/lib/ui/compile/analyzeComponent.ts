import { desugarSignals } from './desugarSignals.ts'
import { lowerDocAccess } from './lowerDocAccess.ts'
import { parseTemplate } from './parseTemplate.ts'
import { scopeCss } from './scopeCss.ts'
import type { AnalyzedComponent } from './types/AnalyzedComponent.ts'

/*
The shared compile front-end: splits `<script>` and `<style>` (and the optional
`<abide>` wrapper) off the template, desugars the signal surface to the doc form,
lowers the script's data access, and parses the template. A `<style>` block is
scoped to a per-component attribute (`data-b-<hash>`) so every back-end adds the
attribute to its elements and emits the scoped CSS. Both client and SSR back-ends
run from this one analysis, so the targets always agree.
*/
export function analyzeComponent(source: string): AnalyzedComponent {
    /* Only the LEADING `<script>` is the component script; scripts nested in the
       template (scoped reactive blocks) survive into the parsed nodes. */
    const scriptMatch = source.match(/^\s*<script[^>]*>([\s\S]*?)<\/script>/)
    const styleMatch = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)
    const scriptBody = (scriptMatch?.[1] ?? '').trim()
    const styleBody = (styleMatch?.[1] ?? '').trim()
    const template = source
        .replace(/^\s*<script[^>]*>[\s\S]*?<\/script>/, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/, '')
        .replace(/<\/?abide[^>]*>/g, '')
        .trim()

    const { code: desugared, stateNames, derivedNames } = desugarSignals(scriptBody)
    const lowered = desugared.trim() === '' ? '' : lowerDocAccess(desugared, 'model')
    /* Hoist top-level import statements (e.g. child components) out of the script
       so the module wrapper can place them at module scope — they can't live
       inside the mount callback / render function. */
    const imports: string[] = []
    const script = lowered
        .replace(/^[ \t]*import\s[^\n]*$/gm, (line) => {
            imports.push(line.trim())
            return ''
        })
        .replace(/\n{2,}/g, '\n')
        .trim()
    const style =
        styleBody === ''
            ? undefined
            : (() => {
                  const attribute = `data-b-${hashString(styleBody)}`
                  return { attribute, css: scopeCss(styleBody, attribute) }
              })()
    const nodes = parseTemplate(template)
    return {
        script,
        imports: imports.join('\n'),
        stateNames,
        derivedNames,
        nodes,
        style,
        /* Hydration adopts every block in place — including `await`, which resumes
           from the streamed value in the resume manifest (see `runtime/RESUME`). */
        hydratable: true,
    }
}

/* Small stable hash (djb2 → base36) for a per-component scope attribute. */
function hashString(value: string): string {
    let hash = 5381
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 33) ^ value.charCodeAt(index)
    }
    return (hash >>> 0).toString(36)
}
