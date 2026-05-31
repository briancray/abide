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
The last remote URL that successfully connected — only prefills the form's input
on a later visit; it never drives a reconnect (the launcher owns auto-resume now,
deciding before the window even opens). Survives disconnect and quitting.
*/
const LAST_URL_KEY = 'belte:last-server-url'

// Injected globals: app title from the launcher, logo data URI from the build.
const heading = (globalThis as { __BELTE_TITLE__?: string }).__BELTE_TITLE__ ?? 'belte app'
const logo = (globalThis as { __BELTE_LOGO__?: string }).__BELTE_LOGO__

const placeholder = 'https://example.com'

// Prefill the form with the last server we connected to, from any prior launch.
let url = $state(localStorage.getItem(LAST_URL_KEY) ?? '')
let error = $state<string | undefined>(undefined)

/*
`?action=` set by the File menu (Start/Disconnect) or the launcher when a live
connection dies (`lost`). Auto-resume of a saved connection now happens in the
launcher before the window opens, so this screen only ever loads as a real
destination — there's no no-action auto-resume left to handle here.
*/
const launchAction = new URLSearchParams(location.search).get('action')

/*
Two phases so the screen never flashes before a redirect. A menu Start may boot
straight through, so it opens on a neutral splash; every other entry is a genuine
destination, so the connect screen shows immediately. Boot/connect re-enter the
splash so a redirect (including after saving config) never flashes the form.
*/
let phase = $state<'splash' | 'connect'>(launchAction === 'start' ? 'splash' : 'connect')

/*
First-run config form, surfaced as a modal only when Start is clicked (or
auto-start fires) with a required key still unset. Fields are derived from the
app's config JSON Schema served by the launcher; answers post back to the
data-dir `.env` the embedded server loads at boot.
*/
type ConfigField = {
    key: string
    label: string
    description?: string
    inputType: 'text' | 'password' | 'number' | 'checkbox'
    required: boolean
}
let configFields = $state<ConfigField[]>([])
let configValues = $state<Record<string, string>>({})
let showConfig = $state(false)
let savingConfig = $state(false)
// Every required field has a value — gates the modal's Save button.
const canSaveConfig = $derived(
    configFields.every(
        (field) =>
            !field.required ||
            field.inputType === 'checkbox' ||
            (configValues[field.key] ?? '').trim() !== '',
    ),
)

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
    if (launchAction === 'start') {
        // File-menu Start Server is an explicit click → run the Start flow.
        void start()
        return
    }
    if (launchAction === 'lost') {
        error = 'The server stopped responding.'
        return
    }
    if (launchAction === 'disconnect') {
        // Have the launcher forget the auto-resume choice and reap any embedded
        // server; LAST_URL_KEY stays so the form is still prefilled to reconnect.
        void fetch('/__belte/disconnect').catch(() => {})
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
    // Hide the form while connecting so a successful redirect doesn't flash it.
    phase = 'splash'
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
        // Prefill the form with this server on a later visit (the launcher records
        // the auto-resume choice itself, on the /connect it just handled).
        localStorage.setItem(LAST_URL_KEY, cleaned)
        location.href = redirect
    } catch (cause) {
        error = `Could not connect: ${String(cause)}`
        // Failed — bring the form back so the error and a retry are visible.
        phase = 'connect'
    }
}

/*
Start, always an explicit click (button or File-menu) — auto-resume happens in
the launcher before the window opens, so this is never a launch path. Asks the
launcher what config the app needs: if it declares any, open the modal (prefilled
with the last-used values) so the user can review or change settings before
booting — re-running Start after a disconnect is how you reconfigure. With no
config schema, boot straight through. The modal's save path resumes the boot.
*/
async function start(): Promise<void> {
    error = undefined
    const config = await loadConfig().catch(() => undefined)
    if (config) {
        configFields = config.fields
        configValues = { ...config.values }
        // Reveal the connect screen as the modal's backdrop.
        phase = 'connect'
        showConfig = true
        return
    }
    await boot()
}

// Boot the embedded server via the launcher, then follow it once it answers.
async function boot(): Promise<void> {
    // Splash while booting so the connect screen doesn't flash before the redirect
    // (including straight after saving config).
    phase = 'splash'
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
        // Boot failed — bring the connect screen back to show the error.
        phase = 'connect'
    }
}

/*
Fetches the app's config schema + resolved current values from the launcher and
turns the JSON Schema into render-ready fields. Returns undefined when no schema
is declared, so Start never gates.
*/
async function loadConfig(): Promise<
    { fields: ConfigField[]; values: Record<string, string> } | undefined
> {
    const response = await fetch('/__belte/config')
    const { schema, values } = (await response.json()) as {
        schema: Record<string, unknown> | null
        values: Record<string, string>
    }
    if (!schema) {
        return undefined
    }
    return { fields: fieldsFromSchema(schema), values: values ?? {} }
}

// Derives one render-ready field per JSON Schema property, reusing the standard
// slots: `title` → label, `description` → hint, `format`/`type` → input kind.
function fieldsFromSchema(schema: Record<string, unknown>): ConfigField[] {
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
    const required = new Set((schema.required as string[]) ?? [])
    return Object.entries(properties).map(([key, property]) => ({
        key,
        label: (property.title as string) ?? key,
        description: property.description as string | undefined,
        inputType: inputType(property),
        required: required.has(key),
    }))
}

// Maps a JSON Schema property to an HTML input kind (directory falls back to text
// until a native picker exists).
function inputType(property: Record<string, unknown>): ConfigField['inputType'] {
    if (property.type === 'boolean') {
        return 'checkbox'
    }
    if (property.type === 'number' || property.type === 'integer') {
        return 'number'
    }
    if (property.format === 'password') {
        return 'password'
    }
    return 'text'
}

// Persist the form's answers to the data-dir `.env`, then resume the boot.
async function saveConfig(): Promise<void> {
    error = undefined
    savingConfig = true
    try {
        const response = await fetch('/__belte/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ values: configValues }),
        })
        if (!response.ok) {
            throw new Error(`save failed (${response.status})`)
        }
        showConfig = false
        savingConfig = false
        await boot()
    } catch (cause) {
        error = `Could not save settings: ${String(cause)}`
        savingConfig = false
    }
}
</script>

{#if phase === 'splash'}
    <!-- Neutral splash shown while an auto-start/auto-reconnect resolves, so the
    connect screen never flashes before it redirects. Same background as the card. -->
    <div
        class="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        {#if logo}
            <img src={logo} alt="" class="h-16 w-16 rounded-xl object-contain opacity-90">
        {/if}
    </div>
{:else}
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
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            Start server
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
{/if}

{#if showConfig}
    <!-- First-run config modal — shown only when Start needs settings the app lacks. -->
    <div
        class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6 text-gray-900 dark:text-gray-100">
        <div
            class="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
            <h2 class="mb-5 text-lg font-semibold tracking-tight">Set up {heading}</h2>

            <form
                class="flex flex-col gap-4"
                onsubmit={(event) => {
                    event.preventDefault()
                    void saveConfig()
                }}>
                {#each configFields as field (field.key)}
                    <label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium">
                            {field.label}
                            {#if field.required}
                                <span class="text-red-500">*</span>
                            {/if}
                        </span>
                        {#if field.inputType === 'checkbox'}
                            <input
                                type="checkbox"
                                checked={configValues[field.key] === 'true'}
                                onchange={(event) =>
                                    (configValues[field.key] = event.currentTarget.checked
                                        ? 'true'
                                        : 'false')}
                                class="mt-1 size-4 self-start rounded border-gray-300 dark:border-gray-700">
                        {:else}
                            <input
                                type={field.inputType}
                                value={configValues[field.key] ?? ''}
                                oninput={(event) =>
                                    (configValues[field.key] = event.currentTarget.value)}
                                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:focus:border-gray-100 dark:focus:ring-gray-100">
                        {/if}
                        {#if field.description}
                            <span class="text-xs text-gray-400 dark:text-gray-500">
                                {field.description}
                            </span>
                        {/if}
                    </label>
                {/each}

                <div class="mt-1 flex gap-3">
                    <button
                        type="button"
                        onclick={() => (showConfig = false)}
                        class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={!canSaveConfig || savingConfig}
                        class="flex-1 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300">
                        {savingConfig ? 'Saving…' : 'Save & start'}
                    </button>
                </div>
            </form>

            {#if error}
                <p class="mt-4 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
            {/if}
        </div>
    </div>
{/if}
