---
"@briancray/belte": patch
---

The generated route-types file (`src/.belte/routes.d.ts`) now augments the `Routes` interface on the module name the project imports belte under (canonical `@briancray/belte` or an alias), matching the rpc/socket/prompt codegen. It previously hardcoded `belte/browser/page`, so `page.route` / `page.params` autocomplete only resolved when belte was installed under the `belte` alias.
