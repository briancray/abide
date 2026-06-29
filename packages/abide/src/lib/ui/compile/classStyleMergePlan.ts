import { interpolatedTemplateLiteral } from './interpolatedTemplateLiteral.ts'
import type { TemplateAttr } from './types/TemplateAttr.ts'

/*
The one decision site for how an element's `class`/`style` base attribute composes
with its `class:`/`style:` directives — lifted out of the two code-gen back-ends
(`generateBuild`, `generateSSR`) so the load-bearing congruence (which attrs fold
into a merged value, and HOW that value's parts concatenate) lives once. Each
back-end RENDERS the returned plan differently — the build into a reactive `effect`,
SSR into a pushed attribute string — but consults the same decision, so the markup
the client clones and the server emits can never drift on the merge logic.

The two back-ends differ ONLY in their merge TRIGGER, because their non-merge
fallbacks differ: the build leaves a STATIC base in the cloned skeleton and toggles
directives surgically, so it merges only when the base is INTERPOLATED (re-set on
every update, which would wipe additive toggles) — `mergeClassBuild`/`mergeStyleBuild`.
SSR must always emit ONE merged attribute string (a duplicate `class`/`style` is
invalid), so it merges whenever a directive exists — `mergeClass`/`mergeStyle`. The
PARTS that compose the value (`classParts`/`styleParts`) are identical either way, so
they are built here once.

`attrs` classified up front; `lower` rewrites the signal surface to `model` (the same
transformer each back-end already threads through its expressions).
*/

/* The base class/style attribute (static or interpolated) found on the element. */
type MergeBase =
    | Extract<TemplateAttr, { kind: 'static' }>
    | Extract<TemplateAttr, { kind: 'interpolated' }>
    | undefined

export type ClassStyleMergePlan = {
    classBase: MergeBase
    styleBase: MergeBase
    classDirectives: Extract<TemplateAttr, { kind: 'class' }>[]
    styleDirectives: Extract<TemplateAttr, { kind: 'style' }>[]
    /* SSR trigger: merge whenever a directive exists (must emit one attribute). */
    mergeClass: boolean
    mergeStyle: boolean
    /* Build trigger: merge only when the base is interpolated (a static base stays in
       the skeleton + surgical toggles). */
    mergeClassBuild: boolean
    mergeStyleBuild: boolean
    /* The JS expression list a merged value joins — base (if any) + directive parts.
       `class` joins on a space (directive name when truthy); `style` joins on `;`
       (`property:value`, String-coerced). Identical across back-ends. */
    classParts: string[]
    styleParts: string[]
}

/* The base class/style attribute (static or interpolated) for one property name. */
function findBase(attrs: TemplateAttr[], name: 'class' | 'style'): MergeBase {
    return attrs.find(
        (attr): attr is NonNullable<MergeBase> =>
            (attr.kind === 'static' || attr.kind === 'interpolated') && attr.name === name,
    )
}

/* The base value as a lowered JS string expression, or undefined when there is no
   base. A static base is a JSON string literal; an interpolated base is its
   template-literal source run through `lower` (embedded signals → `model`). */
function baseExpr(base: MergeBase, lower: (code: string) => string): string | undefined {
    if (base === undefined) {
        return undefined
    }
    return base.kind === 'static'
        ? JSON.stringify(base.value)
        : lower(interpolatedTemplateLiteral(base.parts))
}

/* Classifies an element's attrs into the class/style merge plan. */
export function classStyleMergePlan(
    attrs: TemplateAttr[],
    lower: (code: string) => string,
): ClassStyleMergePlan {
    const classBase = findBase(attrs, 'class')
    const styleBase = findBase(attrs, 'style')
    const classDirectives = attrs.filter(
        (attr): attr is Extract<TemplateAttr, { kind: 'class' }> => attr.kind === 'class',
    )
    const styleDirectives = attrs.filter(
        (attr): attr is Extract<TemplateAttr, { kind: 'style' }> => attr.kind === 'style',
    )
    const classBaseExpr = baseExpr(classBase, lower)
    const styleBaseExpr = baseExpr(styleBase, lower)
    return {
        classBase,
        styleBase,
        classDirectives,
        styleDirectives,
        mergeClass: classDirectives.length > 0,
        mergeStyle: styleDirectives.length > 0,
        mergeClassBuild: classBase?.kind === 'interpolated' && classDirectives.length > 0,
        mergeStyleBuild: styleBase?.kind === 'interpolated' && styleDirectives.length > 0,
        classParts: [
            ...(classBaseExpr === undefined ? [] : [classBaseExpr]),
            ...classDirectives.map(
                (dir) => `((${lower(dir.code)}) ? ${JSON.stringify(dir.name)} : "")`,
            ),
        ],
        styleParts: [
            ...(styleBaseExpr === undefined ? [] : [styleBaseExpr]),
            ...styleDirectives.map(
                (dir) => `(${JSON.stringify(`${dir.property}:`)} + String(${lower(dir.code)}))`,
            ),
        ],
    }
}
