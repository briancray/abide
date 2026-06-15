import { desugarSignals } from './desugarSignals.ts'
import { lowerDocAccess } from './lowerDocAccess.ts'
import { parseTemplate } from './parseTemplate.ts'
import { scopeCss } from './scopeCss.ts'
import type { AnalyzedComponent } from './types/AnalyzedComponent.ts'

/*
The shared compile front-end: splits `<script>` and `<style>` (and the optional
`<belte>` wrapper) off the template, desugars the signal surface to the doc form,
lowers the script's data access, and parses the template. A `<style>` block is
scoped to a per-component attribute (`data-b-<hash>`) so every back-end adds the
attribute to its elements and emits the scoped CSS. Both client and SSR back-ends
run from this one analysis, so the targets always agree.
*/
export function analyzeComponent(source: string): AnalyzedComponent {
    const scriptMatch = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)
    const styleMatch = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)
    const scriptBody = (scriptMatch?.[1] ?? '').trim()
    const styleBody = (styleMatch?.[1] ?? '').trim()
    const template = source
        .replace(/<script[^>]*>[\s\S]*?<\/script>/, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/, '')
        .replace(/<\/?belte[^>]*>/g, '')
        .trim()

    const { code: desugared, stateNames, derivedNames } = desugarSignals(scriptBody)
    const script = desugared.trim() === '' ? '' : lowerDocAccess(desugared, 'model')
    const style =
        styleBody === ''
            ? undefined
            : (() => {
                  const attribute = `data-b-${hashString(styleBody)}`
                  return { attribute, css: scopeCss(styleBody, attribute) }
              })()
    return { script, stateNames, derivedNames, nodes: parseTemplate(template), style }
}

/* Small stable hash (djb2 → base36) for a per-component scope attribute. */
function hashString(value: string): string {
    let hash = 5381
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 33) ^ value.charCodeAt(index)
    }
    return (hash >>> 0).toString(36)
}
