<!--
Root layout. Wraps every page below src/browser/pages/. Layouts are nearest-only:
the deepest matching layout.svelte runs and replaces ancestors — they don't
stack. To inherit chrome in a nested layout, extract a snippet and
{@render} it from each layout. Layouts run on both the server (during SSR)
and the client (after hydration).
-->
<script lang="ts">
import '../app.css'

let { children }: { children: import('svelte').Snippet } = $props()
</script>

<svelte:head>
    <title>abide app</title>
</svelte:head>

<header>
    <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
    </nav>
</header>
<main>
    {@render children()}
</main>
