import { analyzeBindings } from './analyzeBindings.ts'
import type { Root } from './ast.ts'
import { buildPlan } from './templatePlan.ts'

// Run the BUILD lane's structural gates over a parsed template and report what it would reject.
//
// The compiler has two lanes off `parse`: the build lane (`analyzeBindings` → `buildPlan` → the two
// emitters) and the check/LSP lane (`emitCheck`). The check lane consumed only `parse`, so it never
// ran the build lane's gates — and four constructs were accepted by `abide check` and hard-thrown by
// `abide build`: a `{Name(…)}` call-form interpolation, a `<script>` inside an element, a second
// root-level `<script>`, and a branch-local `<script>` that is not its block body's first node. A
// green `abide check` followed by a failing build is the worst version of that gap, because check is
// what an editor runs on every keystroke.
//
// The two lanes keep separate LOWERINGS on purpose — `emitCheck` maps a `{#for}` to a real TS
// `for…of` so TS's own scoping and narrowing flow through it, which is the right output for a type
// check and the wrong one for a runtime. What they must not keep separate is which templates are
// LEGAL. That question is the build lane's, and this is the one place the check lane asks it.
//
// Returns the rejection message, or undefined when the template passes. Positions are not carried:
// the gates throw plain Errors naming the fix, and the caller reports them at the file head. Giving
// them offsets means threading a position through every gate, which is worth doing when one of these
// messages is common enough to be annoying — not before.
export function validateTemplate(root: Root): string | undefined {
    try {
        buildPlan(root, analyzeBindings(root))
        return undefined
    } catch (rejected) {
        return rejected instanceof Error ? rejected.message : String(rejected)
    }
}
