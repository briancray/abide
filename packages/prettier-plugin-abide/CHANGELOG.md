# @abide/prettier-plugin-abide

## 0.1.1

### Patch Changes

- [`748438c`](https://github.com/briancray/abide/commit/748438c6c166de2f2256179197a36e5014f2bd06) - shield component tags from the HTML lowercasing pass ([`5f09a4c`](https://github.com/briancray/abide/commit/5f09a4ce59bb0722993e8ce6427dd42d46f754df))

## 0.1.0

### Minor Changes

- [#9](https://github.com/briancray/abide/pull/9) [`830fa52`](https://github.com/briancray/abide/commit/830fa52d9ddc13d90586425a246519b69c295251) Thanks [@briancray](https://github.com/briancray)! - feat: new package — a Prettier plugin for `.abide` single-file components. Biome can't map the custom extension to a parser, so it never formats inside a component. This reflows the template markup through Prettier's HTML engine (masking abide's `{…}` grammar past the HTML parser) and formats every `<script>` as TypeScript, every `<style>` as CSS, and the code inside every `{…}` interpolation/directive as a TypeScript expression. Runs under Bun (`bunx prettier`); wire it up with a `prettier.config.mjs` listing `@abide/prettier-plugin-abide` and, in Zed, an external `bunx prettier --stdin-filepath {buffer_path}` formatter for the `Abide` language.
