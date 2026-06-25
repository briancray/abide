# @abide/prettier-plugin-abide

## 0.2.0

### Minor Changes

- [`568956c`](https://github.com/briancray/abide/commit/568956c88ff1d32ca79a2aa8a1a0ffffeb25afe3) - block control-flow grammar formatting + shared helpers ([`b39c0a7`](https://github.com/briancray/abide/commit/b39c0a70696b031b63ef157c67360c2da0fd60b0))

### Patch Changes

- [`568956c`](https://github.com/briancray/abide/commit/568956c88ff1d32ca79a2aa8a1a0ffffeb25afe3) - satisfy noUncheckedIndexedAccess in block-token + shadow paths ([`fbb6e44`](https://github.com/briancray/abide/commit/fbb6e4443932e92277fb332b639c746663c7759b))

## 0.1.4

### Patch Changes

- [`ae15b27`](https://github.com/briancray/abide/commit/ae15b2733c3c569b9bde9e4d79f9b768836b3a46) - skip > inside quoted attrs when scanning raw-body open tags ([`a271ebb`](https://github.com/briancray/abide/commit/a271ebbb649bbf6215f691fe063fcf7cc908d25e))

## 0.1.3

### Patch Changes

- [`2efd4ad`](https://github.com/briancray/abide/commit/2efd4ad1e572c46a0611d3d1d5cd1a02f80da629) - use function replacers to preserve $ patterns ([`38d7214`](https://github.com/briancray/abide/commit/38d72145bff970dcd78e96475f3509a209a21558))

## 0.1.2

### Patch Changes

- [`df051ca`](https://github.com/briancray/abide/commit/df051ca7014e557f62bc6ac8eebcdf2036e8cac4) - make nested block-body formatting idempotent ([`3f86bb3`](https://github.com/briancray/abide/commit/3f86bb32aaa8fe260063ae412a4247baf0fc490e))

- [`df051ca`](https://github.com/briancray/abide/commit/df051ca7014e557f62bc6ac8eebcdf2036e8cac4) - shield component tags inside quoted attribute values ([`ec9905a`](https://github.com/briancray/abide/commit/ec9905a4ef6e59038773d47133234f808fc54e4d))

## 0.1.1

### Patch Changes

- [`748438c`](https://github.com/briancray/abide/commit/748438c6c166de2f2256179197a36e5014f2bd06) - shield component tags from the HTML lowercasing pass ([`5f09a4c`](https://github.com/briancray/abide/commit/5f09a4ce59bb0722993e8ce6427dd42d46f754df))

## 0.1.0

### Minor Changes

- [#9](https://github.com/briancray/abide/pull/9) [`830fa52`](https://github.com/briancray/abide/commit/830fa52d9ddc13d90586425a246519b69c295251) Thanks [@briancray](https://github.com/briancray)! - feat: new package — a Prettier plugin for `.abide` single-file components. Biome can't map the custom extension to a parser, so it never formats inside a component. This reflows the template markup through Prettier's HTML engine (masking abide's `{…}` grammar past the HTML parser) and formats every `<script>` as TypeScript, every `<style>` as CSS, and the code inside every `{…}` interpolation/directive as a TypeScript expression. Runs under Bun (`bunx prettier`); wire it up with a `prettier.config.mjs` listing `@abide/prettier-plugin-abide` and, in Zed, an external `bunx prettier --stdin-filepath {buffer_path}` formatter for the `Abide` language.
