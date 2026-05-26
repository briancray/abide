<script lang="ts">
import { login } from '$rpc/login.ts'
</script>

<h1 class="text-2xl font-bold">Log in</h1>
<p class="mt-2 text-sm text-slate-300">
    Form posts directly to <code class="font-mono">{login.url}</code>
    using <code class="font-mono">action={'{login.url}'}</code>
    — no JavaScript required. On success the handler 303-redirects to
    <code class="font-mono">/auth/dashboard</code>; the auth layout's
    <code class="font-mono">cache(getSession)()</code>
    picks up the new cookie on the next render.
</p>

<form
    method="POST"
    action={login.url}
    class="mt-6 flex max-w-sm flex-col gap-3">
    <label class="text-xs font-medium">
        username
        <input
            name="username"
            placeholder="anything non-empty"
            autocomplete="off"
            class="mt-1 block w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" />
    </label>
    <button
        type="submit"
        class="rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-900 hover:bg-slate-300">
        Sign in
    </button>
</form>
