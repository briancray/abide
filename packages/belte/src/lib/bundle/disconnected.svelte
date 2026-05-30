<script lang="ts">
/*
Default bundle connect screen. The launcher serves this (with the logo baked in
at build time and the app title injected at runtime) instead of a blank window,
and overriding it is a matter of dropping a `src/bundle/disconnected.svelte`.

It both connects to a remote server by URL and boots the embedded server, talking
to the launcher's in-process control server: POST /connect and POST /start each
reply with a `{ redirect }` the page follows, while the launcher records the
connection so the native File menu's enabled state stays authoritative.
*/

/*
localStorage key holding the last connection so a relaunch repeats it: either a
remote server URL, or the START_EMBEDDED sentinel meaning "boot the embedded
server". The embedded server's own URL can't be persisted — it picks a fresh
port each launch — so we persist the intent and re-run start() instead.
Disconnect clears it so a relaunch never auto-retries a forgotten server.
*/
const STORAGE_KEY = 'belte:server-url'
const START_EMBEDDED = 'belte:start-embedded'

/*
The last remote URL that successfully connected, kept separate from STORAGE_KEY
so it survives disconnect (and the app quitting): it only prefills the form, it
never drives an auto-reconnect, so reconnecting to the same server stays one
click away even after an explicit disconnect.
*/
const LAST_URL_KEY = 'belte:last-server-url'

// Injected globals: app title from the launcher, logo data URI from the build.
const heading = (globalThis as { __BELTE_TITLE__?: string }).__BELTE_TITLE__ ?? 'belte app'
const logo = (globalThis as { __BELTE_LOGO__?: string }).__BELTE_LOGO__

const placeholder = 'https://example.com'

// Prefill the form with the last server we connected to, from any prior launch.
let url = $state(localStorage.getItem(LAST_URL_KEY) ?? '')
let starting = $state(false)
let error = $state<string | undefined>(undefined)

/*
Interpret the boot intent once on load. `?action=` is set by the native File
menu's navigate items (or the launcher when a live connection dies); absent it, a
remembered server reconnects automatically:
  - start      → boot the embedded server (matches the Start Server menu item).
  - lost       → the connected server stopped responding; explain and wait (the
                 form is already prefilled with the last URL for a one-click retry).
  - disconnect → forget the URL + tear down any embedded server, stay here so the
                 form is the place to point at another server.
  - (none)     → reconnect to the saved server if there is one.
*/
$effect(() => {
    const action = new URLSearchParams(location.search).get('action')
    const saved = localStorage.getItem(STORAGE_KEY) ?? undefined
    if (action === 'start') {
        void start()
        return
    }
    if (action === 'lost') {
        error = 'The server stopped responding.'
        return
    }
    if (action === 'disconnect') {
        // Forget the auto-reconnect intent but keep LAST_URL_KEY, so the form
        // stays prefilled with the server we just left for a one-click return.
        localStorage.removeItem(STORAGE_KEY)
        void fetch('/__belte/disconnect').catch(() => {})
        return
    }
    // No action: repeat the last choice — re-boot the embedded server, or reconnect.
    if (saved === START_EMBEDDED) {
        void start()
        return
    }
    if (saved) {
        void connect(saved)
    }
})

/*
Ask the launcher to connect to a server by URL. It verifies the URL really is a
belte server — POST /connect probes the target's identity endpoint — and flips the
native menu's connected flag before replying with the `{ redirect }` to follow; a
URL that isn't a belte server comes back as an error shown below the form. Only a
confirmed URL is remembered, so a relaunch never auto-retries a dead or wrong
address. The saved-URL reconnect path runs through here too.
*/
async function connect(target: string = url.trim()): Promise<void> {
    const cleaned = target.trim()
    if (!cleaned) {
        return
    }
    error = undefined
    try {
        const response = await fetch('/connect', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: cleaned }),
        })
        if (!response.ok) {
            const body = (await response.json()) as { error?: string }
            throw new Error(body.error ?? `connect failed (${response.status})`)
        }
        const { redirect } = (await response.json()) as { redirect: string }
        localStorage.setItem(STORAGE_KEY, cleaned)
        // Remember it separately so it outlives a later disconnect and prefills the form.
        localStorage.setItem(LAST_URL_KEY, cleaned)
        location.href = redirect
    } catch (cause) {
        error = `Could not connect: ${String(cause)}`
    }
}

// Boot the embedded server via the launcher, then follow it once it answers.
async function start(): Promise<void> {
    error = undefined
    starting = true
    // Remember the embedded-server choice so the next launch boots it automatically.
    localStorage.setItem(STORAGE_KEY, START_EMBEDDED)
    try {
        const response = await fetch('/start', { method: 'POST' })
        if (!response.ok) {
            const body = (await response.json()) as { error?: string }
            throw new Error(body.error ?? `start failed (${response.status})`)
        }
        const { redirect } = (await response.json()) as { redirect: string }
        location.href = redirect
    } catch (cause) {
        error = `Could not start the server: ${String(cause)}`
        starting = false
    }
}
</script>

<main
    class="flex min-h-screen items-center justify-center bg-gray-50 p-6 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
    <div
        class="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
        {#if logo}
            <img src={logo} alt="" class="mx-auto mb-5 h-16 w-16 rounded-xl object-contain">
        {/if}
        <h1 class="mb-6 text-center text-xl font-semibold tracking-tight">{heading}</h1>

        <form
            class="flex flex-col gap-3"
            onsubmit={(event) => {
                event.preventDefault()
                void connect()
            }}>
            <input
                type="url"
                bind:value={url}
                {placeholder}
                autocomplete="url"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:focus:border-gray-100 dark:focus:ring-gray-100">
            <button
                type="submit"
                class="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300">
                Connect
            </button>
        </form>

        <div class="my-5 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
            <span class="h-px flex-1 bg-gray-200 dark:bg-gray-800"></span>
            or
            <span class="h-px flex-1 bg-gray-200 dark:bg-gray-800"></span>
        </div>

        <button
            type="button"
            onclick={() => void start()}
            disabled={starting}
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800">
            {starting ? 'Starting…' : 'Start server'}
        </button>

        {#if error}
            <p class="mt-4 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
        {/if}

        <p class="mt-8 text-center text-xs text-gray-400 dark:text-gray-500">
            made with
            <a
                href="https://github.com/briancray/belte"
                class="underline hover:text-gray-600 dark:hover:text-gray-300">
                belte
            </a>
        </p>
    </div>
</main>
