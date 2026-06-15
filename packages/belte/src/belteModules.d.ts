/* Ambient type for `.belte` single-file component imports: the default export is a
   compiled belte-ui component (client mounter + SSR render + hydration hooks). */
declare module '*.belte' {
    import type { UiComponent } from './lib/ui/runtime/types/UiComponent.ts'

    const component: UiComponent
    export default component
}
