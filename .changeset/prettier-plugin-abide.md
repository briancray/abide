---
"@abide/prettier-plugin-abide": minor
---

feat: new package — a Prettier plugin for `.abide` single-file components. Biome can't map the custom extension to a parser, so it never formats inside a component. This reflows the template markup through Prettier's HTML engine (masking abide's `{…}` grammar past the HTML parser) and formats every `<script>` as TypeScript, every `<style>` as CSS, and the code inside every `{…}` interpolation/directive as a TypeScript expression. Runs under Bun (`bunx prettier`); wire it up with a `prettier.config.mjs` listing `@abide/prettier-plugin-abide` and, in Zed, an external `bunx prettier --stdin-filepath {buffer_path}` formatter for the `Abide` language.
