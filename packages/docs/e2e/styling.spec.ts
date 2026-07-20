import { expect, test } from "@playwright/test"

// Scoped <style> (#13/#20): a component's <style> rewrites `.swatch` → `.swatch[data-ab-*]` and
// stamps that attribute on the element it renders — on BOTH the server HTML and the hydrated client
// DOM. This is the regression guard for #20: before the SERVER emitter stamped the scope attribute,
// the SSR'd element carried no attribute, so the rewritten selector matched nothing and the styles
// only appeared on a fresh client mount (never after SSR/hydration).

test("a component-scoped <style> applies to its own element after SSR + hydration", async ({
  page,
}) => {
  await page.goto("/styling")

  const swatch = page.getByTestId("scoped-swatch")
  await expect(swatch).toBeVisible()

  // The scoped rule (emerald) actually applies — so the scope attribute IS present on the
  // server-rendered element the client claimed during hydration.
  await expect(swatch).toHaveCSS("color", "rgb(16, 185, 129)")

  // …and the element carries a `data-ab-*` scope attribute.
  const hasScopeAttr = await swatch.evaluate((el) =>
    el.getAttributeNames().some((n) => n.startsWith("data-ab-")),
  )
  expect(hasScopeAttr).toBe(true)

  // The rule targets only `.swatch`, so a sibling without the class is untouched.
  await expect(page.getByTestId("scoped-plain")).not.toHaveCSS("color", "rgb(16, 185, 129)")
})
