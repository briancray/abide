import { desugarSignals } from './desugarSignals.ts'
import { lowerDocAccess } from './lowerDocAccess.ts'
import { parseTemplate } from './parseTemplate.ts'
import type { AnalyzedComponent } from './types/AnalyzedComponent.ts'

/*
The shared compile front-end: splits `<script>` (and the optional `<belte>`
wrapper) off the template, desugars the signal surface to the doc form, lowers
the script's data access to patches/reads, and parses the template. Both the
client and SSR back-ends run from this one analysis, so the two targets always
agree on the lowered script and the binding names.
*/
export function analyzeComponent(source: string): AnalyzedComponent {
    const scriptMatch = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)
    const scriptBody = (scriptMatch?.[1] ?? '').trim()
    const template = source
        .replace(/<script[^>]*>[\s\S]*?<\/script>/, '')
        .replace(/<\/?belte[^>]*>/g, '')
        .trim()

    const { code: desugared, stateNames, derivedNames } = desugarSignals(scriptBody)
    const script = desugared.trim() === '' ? '' : lowerDocAccess(desugared, 'model')
    return { script, stateNames, derivedNames, nodes: parseTemplate(template) }
}
