import type { TemplateNode } from './types/TemplateNode.ts'

/* The authored props of a child-component node (each attribute lowered to a prop;
   a `spread` entry carries no `name`). */
type ComponentProps = Extract<TemplateNode, { kind: 'component' }>['props']

/*
The props-bag source expression a child mount/render receives, shared by the build
and SSR back-ends so their last-wins layering stays byte-identical — the invariant
SSR/client prop congruence rests on. No spread → the plain object literal of named
value thunks (+ the trailing slot). With a `{...expr}` spread → a `mergeProps` of
ordered layers — explicit-prop runs, `$$spreadProps(expr)` spreads, the slot —
resolved last-wins per key, so source order decides overrides (like JSX).
`lowerExpression` is the caller's expression lowering; `slotPart` is its `$children`
layer (a host-taking builder for the client, a string-returning thunk for SSR) or
undefined when the component has no slotted children.
*/
export function composeProps(
    props: ComponentProps,
    lowerExpression: (code: string) => string,
    slotPart: string | undefined,
): string {
    const propThunk = (prop: { name: string; code: string }): string =>
        `${JSON.stringify(prop.name)}: () => (${lowerExpression(prop.code)})`
    if (!props.some((prop) => prop.spread)) {
        const parts = props.map(propThunk)
        if (slotPart !== undefined) {
            parts.push(slotPart)
        }
        return `{ ${parts.join(', ')} }`
    }
    const layers: string[] = []
    let run: string[] = []
    const flushRun = (): void => {
        if (run.length > 0) {
            layers.push(`{ ${run.join(', ')} }`)
            run = []
        }
    }
    for (const prop of props) {
        if (prop.spread) {
            flushRun()
            layers.push(`$$spreadProps(() => (${lowerExpression(prop.code)}))`)
        } else {
            run.push(propThunk(prop))
        }
    }
    flushRun()
    if (slotPart !== undefined) {
        layers.push(`{ ${slotPart} }`)
    }
    return `$$mergeProps([${layers.join(', ')}])`
}
