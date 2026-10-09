// 35.4 — what a `.ts` holds where it imports a `.abide`: the component, called with its props to
// bind them, answering the `Component` `render` takes (`componentImports`). A wildcard, so the props
// are not checked here; a declaration in a module would be an augmentation, which takes no wildcard.
declare module '*.abide' {
    const component: (
        props?: Record<string, unknown>,
    ) => import('./render.ts').Component
    export default component
}
