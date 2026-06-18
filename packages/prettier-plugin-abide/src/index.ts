import type { Plugin } from 'prettier'
import { abideParser } from './abideParser.ts'
import { abidePrinter } from './abidePrinter.ts'

/*
A Prettier plugin for `.abide` single-file components. Biome (the repo formatter)
can't map a custom extension to a parser, so it never sees inside a component. This
plugin reflows the template markup through Prettier's HTML engine and formats every
`<script>` (leading + nested reactive blocks) as TypeScript, every `<style>` as CSS,
and the code inside every `{…}` interpolation/directive as a TypeScript expression.
The trick that makes the markup pass possible — masking abide's `{…}` grammar past
the HTML parser — lives in formatAbideSource.
*/
const plugin: Plugin = {
    languages: [
        {
            name: 'abide',
            parsers: ['abide'],
            extensions: ['.abide'],
            vscodeLanguageIds: ['abide'],
        },
    ],
    parsers: { abide: abideParser },
    printers: { 'abide-ast': abidePrinter },
}

export default plugin
