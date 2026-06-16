/* Normalizes a scope option (one tag or many) to a Set for O(1) membership. */
export function toScopeSet(scope: string | string[]): Set<string> {
    return new Set(typeof scope === 'string' ? [scope] : scope)
}
