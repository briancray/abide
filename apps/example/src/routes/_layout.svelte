<script lang="ts">
import '../app.css'

let { children } = $props()
</script>

<svelte:head>
  <title>example</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 text-slate-900">
  <header class="border-b border-slate-200 bg-white">
    <nav class="mx-auto flex max-w-3xl items-center gap-4 px-6 py-4">
      <a href="/" class="font-semibold">example</a>
      <a href="/" class="text-slate-600 hover:text-slate-900">Home</a>
      <a href="/about" class="text-slate-600 hover:text-slate-900">About</a>
    </nav>
  </header>
  <main class="mx-auto max-w-3xl px-6 py-10">
    {@render children()}
  </main>
</div>
