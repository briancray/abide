// `.abide` EMITTED SCRIPT SETUP (Stage 1, PR3) — BUILD/SERVER-SIDE ONLY.
//
// Generates the lexical `<script>` setup preamble shared by the emitted client (`mount`) and server
// (`render`) functions, plus the module-scope memoizer. Mirrors `assembleCore.makeScopeBuilder`
// without `with`/`new Function`: script imports become `const greet = $scope.greet;`, cells become
// real `let n = state(0)` (references already rewritten to `.read()/.write()` by analyzeScope), and
// `<script module>` is a lazily-memoized `$ensureModule($scope)`.

import type { ImportBinding, ScopeAnalysis, ScriptInfo } from './analyzeScope.ts'

// Names bound by an import (default, namespace, named locals). `skip` excludes component-import locals
// (`.abide` default imports): those are REAL ES imports at module top, not `$scope` reads, so they must
// not be aliased/destructured here.
function importLocals(imports: ImportBinding[], skip?: Set<string>): string[] {
    const locals: string[] = []
    for (const binding of imports) {
        if (binding.defaultLocal !== null && !skip?.has(binding.defaultLocal))
            locals.push(binding.defaultLocal)
        if (binding.namespaceLocal !== null && !skip?.has(binding.namespaceLocal))
            locals.push(binding.namespaceLocal)
        for (const entry of binding.named) if (!skip?.has(entry.local)) locals.push(entry.local)
    }
    return locals
}

function importAliasLines(script: ScriptInfo | null, skip: Set<string>): string {
    if (script === null) return ''
    let out = ''
    for (const local of importLocals(script.imports, skip)) {
        out += `  const ${local} = $scope[${JSON.stringify(local)}];\n`
    }
    return out
}

// Locals that are REAL ES imports at module top (`.abide` components + pass-through `abide/*` module
// imports), excluded from every `$scope` alias/destructure — they resolve lexically, not off `$scope`.
function componentLocalSet(analysis: ScopeAnalysis): Set<string> {
    const set = new Set<string>()
    for (const entry of analysis.componentImports) set.add(entry.local)
    for (const binding of analysis.moduleImports) {
        if (binding.defaultLocal !== null) set.add(binding.defaultLocal)
        if (binding.namespaceLocal !== null) set.add(binding.namespaceLocal)
        for (const entry of binding.named) set.add(entry.local)
    }
    return set
}

// EVERY name a `<script module>` binds that the template/instance may reference — its import locals
// AND its non-import declarations (consts/functions/cells). Both must be carried out of the memoized
// `$ensureModule` into instance scope: a `<script module>` that `import`s an RPC and uses it in the
// template (`{await hello(...)}`) needs `hello` in `render`/`mount`, not just inside `$ensureModule`.
// Deduped (a name can't be both an import and a decl, but guard anyway).
function moduleBindingNames(script: ScriptInfo, componentLocals: Set<string>): string[] {
    const seen = new Set<string>()
    const names: string[] = []
    for (const local of importLocals(script.imports, componentLocals)) {
        if (!seen.has(local)) {
            seen.add(local)
            names.push(local)
        }
    }
    for (const binding of script.bindings) {
        if (binding.kind === 'import') continue
        if (!seen.has(binding.name)) {
            seen.add(binding.name)
            names.push(binding.name)
        }
    }
    return names
}

// The module-level memoizer declaration (empty when there is no `<script module>`). Imports are
// resolved from the first call's `$scope` and memoized alongside the module's one-time setup — module
// scope is by definition computed once; server RPC callables forward to the live request scope, and
// ambient accessors are stable references, so caching them is correct.
export function emitModuleEnsure(analysis: ScopeAnalysis): string {
    const moduleScript = analysis.module
    if (moduleScript === null) return ''
    const componentLocals = componentLocalSet(analysis)
    const names = moduleBindingNames(moduleScript, componentLocals)
    return (
        `let $module;\n` +
        `function $ensureModule($scope) {\n` +
        `  if ($module !== undefined) return $module;\n` +
        importAliasLines(moduleScript, componentLocals) +
        `${moduleScript.setupCode}\n` +
        `  $module = { ${names.join(', ')} };\n` +
        `  return $module;\n` +
        `}\n`
    )
}

// Every name the instance script itself binds (imports + decls) — these take precedence, so a module
// binding of the same name is NOT destructured from `$ensureModule` (that would double-declare a
// `const`; the instance re-imports/re-declares it in the lines that follow).
function instanceDeclaredNames(
    script: ScriptInfo | null,
    componentLocals: Set<string>,
): Set<string> {
    const names = new Set<string>()
    if (script === null) return names
    for (const local of importLocals(script.imports, componentLocals)) names.add(local)
    for (const binding of script.bindings)
        if (!componentLocals.has(binding.name)) names.add(binding.name)
    return names
}

// The per-instance setup preamble, emitted at the top of `render`/`mount` (indented two spaces).
export function emitInstanceSetup(analysis: ScopeAnalysis): string {
    let out = ''
    const componentLocals = componentLocalSet(analysis)
    if (analysis.module !== null) {
        const shadowed = instanceDeclaredNames(analysis.instance, componentLocals)
        // A `<script module>`'s IMPORTS (RPC proxies / ambient accessors) are re-aliased from the CURRENT
        // instance `$scope` on every mount — NOT frozen into the once-memoized `$module`. On the client the
        // seed replay installs FRESH per-nav proxies into `$scope` before each mount; freezing the first
        // mount's proxy made a soft-nav read the stale (previous-nav-seeded) cell, so e.g. a `[slug]` page's
        // `{#await topic({ slug })}` missed the new seed and hydrated `undefined` (→ whole-page fallback +
        // duplicate render). Only the module's own DECLARATIONS (consts/functions) keep once-semantics.
        const moduleImports = importLocals(analysis.module.imports, componentLocals).filter(
            (name) => !shadowed.has(name),
        )
        const declNames = moduleBindingNames(analysis.module, componentLocals).filter(
            (name) => !shadowed.has(name) && !moduleImports.includes(name),
        )
        if (declNames.length > 0)
            out += `  const { ${declNames.join(', ')} } = $ensureModule($scope);\n`
        else out += `  $ensureModule($scope);\n`
        for (const name of moduleImports)
            out += `  const ${name} = $scope[${JSON.stringify(name)}];\n`
    }
    out += importAliasLines(analysis.instance, componentLocals)
    if (analysis.instance !== null) out += `${analysis.instance.setupCode}\n`
    return out
}
