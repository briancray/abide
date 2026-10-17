# @abide/bridge

## 0.3.2

### Patch Changes

- fda92c3: a site holds a dropped bridge pairing for 60 seconds, past when the bridge notices a silent drop ([`ac8e1d3`](https://github.com/briancray/abide/commit/ac8e1d313b7ea54414cd1034b56eb4cfa88ab31b))

## 0.3.1

### Patch Changes

- cc6f899: a bridge stopped by SIGTERM, SIGINT or SIGHUP ends every Claude Code run it started before it exits ([`5847a59`](https://github.com/briancray/abide/commit/5847a59e0de0d45ed1ea11b526fda27c24490ebc))

## 0.3.0

### Minor Changes

- bd2a74f: Breaking: an assistant announces a tool call as the model starts writing it, and a site may ask the visitor's Claude Code for built-in tools ([`c959804`](https://github.com/briancray/abide/commit/c959804fd19c3e99fe439f3f1120f1ef13f42ff8))

## 0.2.0

### Minor Changes

- 9aa03a5: socket mux bounds, request ceilings, stop timeout, scroll restore, numeric and composed bind:value, and keyed rows kept across patches (16.78, 18.28-18.32, 30.29-30.31, 32.58-32.62, 32.66, 32.67, 42.17) ([`301bf47`](https://github.com/briancray/abide/commit/301bf47adf5059271b439fe3c129963861dd1c72))
