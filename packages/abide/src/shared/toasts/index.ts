// The `toasts` namespace: notices that take themselves down, shown where the app spreads `toasts.host` (50.12).
export { dismiss } from './dismiss.ts'
export {
    host,
    type ToastParts,
    type ToastsHost,
    type ToastsHostOptions,
} from './host.ts'
export { list } from './list.ts'
export { notify } from './notify.ts'
