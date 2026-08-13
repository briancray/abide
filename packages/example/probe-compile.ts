import { compile } from 'abide/compiler'
const body = (inner: string) => `<script module>
import { state } from 'abide'
let n = 0
export const c = state(1)
export const go = (): void => {
${inner}
}
</script>
<p>{c}</p>`
const cases: Record<string, string> = {
    'plain ++ ; cell write': '    n++\n    c = 2',
    'plain ++ ; plain write': '    n++\n    n = 2',
    'cell ++ ; cell write': '    c++\n    c = 2',
    'plain ++ with semicolon ; cell write': '    n++;\n    c = 2',
    'plain -- ; cell write': '    n--\n    c = 2',
    'plain += ; cell write': '    n += 1\n    c = 2',
}
for (const [name, inner] of Object.entries(cases)) {
    const out = compile(body(inner), { filename: 't.abide' }).code
    const fn = /go = \(\): void => \{(.*?)\n\}/s.exec(out)
    console.log(name.padEnd(38), '=>', JSON.stringify(fn?.[1] ?? '??'))
}
