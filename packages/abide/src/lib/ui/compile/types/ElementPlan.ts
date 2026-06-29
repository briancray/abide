import type { ClassStyleMergePlan } from '../classStyleMergePlan.ts'
import type { TemplateAttr } from './TemplateAttr.ts'

/*
The per-element shared compile decision both back-ends render from — the element-level
sibling of `skeletonContext`'s tree-level positional model, layered over it (ADR-0013).
It centralizes the DECISIONS the two code-gen back-ends (`generateBuild`, `generateSSR`)
previously made twice in hand-mirrored per-attribute dispatch: each attribute's kind, the
class/style/directive merge, which attrs are folded into that merge (so both skip them),
and whether the tag is void. Each back-end still RENDERS per kind — build wires live
effects/thunks, SSR escapes strings — but consults ONE classification, so the markup the
client clones and the server emits can never drift on the attribute set or merge logic.

The positional holes/anchors are NOT recomputed here — they stay in `skeletonContext` and
each back-end reads `elIndex`/`anIndex`/`markText` from it. `elementPlan` is the decision
on TOP of that positional pass, not a second positional model.
*/

/* One classified attribute on an element. `attr` is the original `TemplateAttr`; `merged*`
   flags it as folded into the class/style merge for that back-end (so the back-end skips it
   in its per-attr dispatch). The merge TRIGGERS differ — build merges only when the base is
   interpolated (a static base stays in the cloned skeleton with surgical toggles), SSR merges
   whenever a directive exists (it must emit one attribute string) — so each side reads its own
   flag. */
export type ElementPlanAttr = {
    attr: TemplateAttr
    /* Folded into the class/style merge on the build back-end (skip in build's dispatch). */
    mergedBuild: boolean
    /* Folded into the class/style merge on the SSR back-end (skip in SSR's dispatch). */
    mergedSSR: boolean
}

export type ElementPlan = {
    /* Every attribute classified in author order, each tagged with its per-back-end merge
       status. Both back-ends iterate this one list and render per `attr.kind`. */
    attrs: ElementPlanAttr[]
    /* The class/style/directive merge decision (`classStyleMergePlan`) folded in as this
       plan's class/style branch — both back-ends render the merged value from its parts. */
    merge: ClassStyleMergePlan
    /* A void tag (`<img>`, `<input>`) has no closing tag and no children — both back-ends
       emit the open tag only. From the shared `VOID_TAGS` set. */
    isVoid: boolean
}
