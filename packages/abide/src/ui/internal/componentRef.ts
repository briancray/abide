import type { ScopeAnalysis } from './analyzeScope.ts'

// The expression that resolves a component tag `name` at mount: a lexically-declared local (an import
// or `<script>` binding) is referenced directly; anything else reads off the injected `$scope`.
export function componentRef(analysis: ScopeAnalysis, name: string): string {
    return analysis.declared.has(name) ? name : `$scope.${name}`
}
