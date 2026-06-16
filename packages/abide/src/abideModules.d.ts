/* Ambient type for `.abide` single-file component imports: the default export is a
   compiled abide-ui component (client mounter + SSR render + hydration hooks). */
declare module '*.abide' {
    import type { UiComponent } from './lib/ui/runtime/types/UiComponent.ts'

    const component: UiComponent
    export default component
}
