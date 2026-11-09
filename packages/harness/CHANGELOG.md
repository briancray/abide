# @abide/harness

## 0.3.2

### Patch Changes

- 90356fb: a document parsed under the preload fetches no stylesheet or script it names — 43.35
- 90356fb: the preload leaves bun its own `WebSocket`, `TransformStream` and `WritableStream` — 43.28
- Updated dependencies [e948e8e]
- Updated dependencies [6f2742a]
- Updated dependencies [74eacfc]
- Updated dependencies [1eaf716]
- Updated dependencies [eb201fb]
- Updated dependencies [eb201fb]
- Updated dependencies [eb201fb]
- Updated dependencies [eb201fb]
- Updated dependencies [fd731a2]
- Updated dependencies [5d05e0e]
- Updated dependencies [c5ea214]
- Updated dependencies [17fdafe]
- Updated dependencies [693c7f3]
- Updated dependencies [20bb20a]
- Updated dependencies [b436c3e]
- Updated dependencies [c49316f]
- Updated dependencies [d3b0202]
- Updated dependencies [02f34f7]
- Updated dependencies [ce73c75]
- Updated dependencies [e93eaf6]
- Updated dependencies [92f7c58]
- Updated dependencies [801345f]
- Updated dependencies [26ebcb7]
- Updated dependencies [3ffb8c0]
- Updated dependencies [380be01]
- Updated dependencies [226e6a7]
- Updated dependencies [cbcd422]
- Updated dependencies [f215b78]
  - @abide/abide@0.125.0

## 0.3.1

### Patch Changes

- a9f8ad1: format the repo with abide format and bun fmt ([`d7cd46d`](https://github.com/briancray/abide/commit/d7cd46da1e0cd523631d38d923f8bb08d1f0716f))
- Updated dependencies [a9f8ad1]
- Updated dependencies [a9f8ad1]
- Updated dependencies [a9f8ad1]
  - @abide/abide@0.119.0

## 0.3.0

### Minor Changes

- 9e24653: `runBenches` (`@abide/harness/runner`) and the `harness-bench` command run every `*.bench.ts` under an app's `src`, print each arm's time and the claim between them, and fail the run where an arm goes over its `CEILINGS` entry or a ceiling names no arm (RULEBOOK 43.29-43.33); `abide scaffold` writes a `bench` script that runs it, and the starter's agent notes say to measure with the harness (RULEBOOK 38.124)

### Patch Changes

- 05ba855: a ceiling naming no bench fails the run, and a bench file sits beside any code it times (RULEBOOK 23.22, 43.32-43.34) ([`d5f3d3c`](https://github.com/briancray/abide/commit/d5f3d3cc6368057f8437559aafc7113abd2b3269))
- Updated dependencies [05ba855]
- Updated dependencies [05ba855]
- Updated dependencies [9e24653]
  - @abide/abide@0.117.1

## 0.2.2

### Patch Changes

- 3c32bf6: an element the client builds takes the namespace the parser gives it there — a component inside an svg draws — and an xlink:href it writes is XLink's; the harness counts createElementNS and setAttributeNS ([`0dd560a`](https://github.com/briancray/abide/commit/0dd560a35d54a86d8ff5d3bc7762ed6c6968c71f))
- Updated dependencies [3c32bf6]
- Updated dependencies [3c32bf6]
- Updated dependencies [3c32bf6]
- Updated dependencies [3c32bf6]
- Updated dependencies [3c32bf6]
- Updated dependencies [3c32bf6]
  - @abide/abide@0.113.0

## 0.2.1

### Patch Changes

- fda92c3: a nested JUnit testsuite joins its file's suite, and signals are passed on only once a suite runs ([`35585df`](https://github.com/briancray/abide/commit/35585df23e3ec3f61fab714a953d8f3ff3244781))
- Updated dependencies [fda92c3]
- Updated dependencies [fda92c3]
- Updated dependencies [fda92c3]
- Updated dependencies [fda92c3]
- Updated dependencies [fda92c3]
  - @abide/abide@0.108.0

## 0.2.0

### Minor Changes

- 9aa03a5: publish @abide/harness, with abide's bench and e2e moved to abide and the arms to the docs app (43.1, 43.21, 43.23, 38.119) ([`8521bd7`](https://github.com/briancray/abide/commit/8521bd7b364d998a1a59f764b51b34cf273f7a84))

### Patch Changes

- 9aa03a5: the DOM preload keeps bun's fetch family (43.28) ([`f162931`](https://github.com/briancray/abide/commit/f162931f99aefff7caf2a651a0797cbcb2a83517))
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
- Updated dependencies [d42dfad]
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
  - @abide/abide@0.106.0
