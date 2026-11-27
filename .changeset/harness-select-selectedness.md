---
'@abide/harness': patch
---

The DOM preload gives `<option>` its `defaultSelected`, and a `<select>` built from markup — parsed, or cloned out of a `<template>` — lands on the option its `selected` attribute marks, so a `form` over a select reads its baseline as a browser does (43.47).
