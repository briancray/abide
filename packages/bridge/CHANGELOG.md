# @abide/bridge

## 0.3.5

### Patch Changes

- a9f8ad1: format the repo with abide format and bun fmt ([`d7cd46d`](https://github.com/briancray/abide/commit/d7cd46da1e0cd523631d38d923f8bb08d1f0716f))

## 0.3.4

### Patch Changes

- 48cfc3e: multimodal transcripts — an `AssistantMessage`'s `content` is its words or its pieces in order, each `AssistantContent` text or an image as base64 with its type. `assistant` refuses an image a model can't take or one outside a user turn, and hands a `Provider` every turn as its pieces, words alone as one text piece. `claudeApi` shows each image to the model as an image block in its place, and `claudeCode` sends the one message Claude Code is sent as Messages API blocks, each image in its place. RULEBOOK 44.5, 44.36, 44.37, 44.38, 44.39

## 0.3.3

### Patch Changes

- f9b3789: a request is never reaped by the idle timeout while it is being answered, an idle connection is reaped after 10 seconds, and every event stream beats every 15 seconds ([`14eea6e`](https://github.com/briancray/abide/commit/14eea6e7ae0b72eb194c16e17ca4e7c4498baf46))

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
