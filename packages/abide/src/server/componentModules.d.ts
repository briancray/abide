// 35.4 — what a `.ts` holds where it imports a `.abide`: the component, called with its props to
// bind them, answering the `Component` `render` takes (`abideModules`). A wildcard, so the props
// are not checked here; a declaration in a module would be an augmentation, which takes no wildcard.
// The component is all a `.abide` exports (34.17).
declare module '*.abide' {
    const component: (
        props?: Record<string, unknown>,
    ) => import('./render.ts').Component
    export default component
}
