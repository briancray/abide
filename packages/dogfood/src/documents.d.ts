// docs/REGISTRY.md and docs/RULEBOOK.md, imported as their text (`with { type: 'text' }`).
declare module '*.md' {
    const text: string
    export default text
}
