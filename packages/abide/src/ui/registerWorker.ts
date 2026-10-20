// 45.1 — THE SERVICE WORKER, REGISTERED where the document carries the tag `ABIDE_OFFLINE` has the
// server write. The route table calls this in every app, so what the server says decides.

import { WORKER_ADDRESS } from '#shared/ADDRESSES.ts'
import { MOUNT, mounted } from '#shared/mount.ts'
import { OFFLINE_META } from '#shared/OFFLINE_META.ts'
import { onPrincipalRotated } from '#shared/principalRotated.ts'
import { HYDRATE_LOG } from './Mismatch.ts'

/** Registers the app's service worker once the page has loaded, over the mount's whole scope. */
export function registerWorker(): void {
    if (document.querySelector(`meta[name="${OFFLINE_META}"]`) === null) return
    if (!('serviceWorker' in navigator)) return
    const workers = navigator.serviceWorker
    const register = (): void => {
        workers
            .register(mounted(WORKER_ADDRESS), {
                scope: `${MOUNT.current()}/`,
            })
            // 45.10
            .catch((error: unknown) =>
                HYDRATE_LOG.warning(
                    'the service worker did not register',
                    error,
                ),
            )
    }
    // AFTER THE LOAD, so installing it — every file of the bundle fetched — does not compete with
    // the page it is installing for.
    if (document.readyState === 'complete') register()
    else addEventListener('load', register, { once: true })
    // 45.7 — a sign-in or sign-out in any tab: the pages it saved were another caller's.
    onPrincipalRotated(() => workers.controller?.postMessage('rotated'), true)
}
