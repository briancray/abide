// abide — ambient module declarations for abide apps.
//
// Pulled into an app's TypeScript program via `/// <reference types="abide" />` (see the
// `src/abide-env.d.ts` that `abide scaffold` writes). Declares the non-`.ts` module shapes abide's
// build understands so `import`s of them type-check WITHOUT each app hand-writing its own
// `globals.d.ts` (TODO #20 / #21 follow-up).

// `import "./styles.css"` — abide bundles imported CSS (Bun.build asset output + Tailwind plugin).
// A CSS module has no runtime value in the app graph; it is a side-effect import.
declare module "*.css";

// `import Card from "./Card.abide"` — a `.abide` component file's default export is a component
// builder (used as `<Card .../>` in a template). See TODO #21 (components as `.abide` files).
declare module "*.abide" {
  const component: (...args: unknown[]) => unknown;
  export default component;
}
