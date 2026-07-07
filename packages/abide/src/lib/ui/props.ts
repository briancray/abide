/*
The prop reader. In a `.abide` component the compiler rewrites `const { name } =
props()` to reads off the component's prop bag (`$props`), so this runtime body
never executes there — it exists for import resolution and for typing `props()`
in plain `.ts` modules. Called directly (only possible outside a compiled
component) it throws, like `request()` outside a request scope, rather than
silently returning undefined.

The return type is `T` (default `Record<string, unknown>`); inside a `.abide`
file the check shadow supplies the file-contextual `RouteShape & T` instead.
*/
// @documentation reactive-state
export function props<T = Record<string, unknown>>(): T {
    throw new Error(
        '[abide] props() is compiler-lowered inside a .abide component and has no runtime meaning when called directly',
    )
}
