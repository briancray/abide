// The `prompts` namespace: a question or a message shown in the app's `Prompts` (50.5). Spelled
// through the namespace so none shadows the browser's own `confirm`, `alert` and `prompt`, and a
// call missing its import fails to compile rather than opening the browser's blocking dialog.
export { alert } from './alert.ts'
export { confirm } from './confirm.ts'
export { host, type PromptsHost, type ShownPrompt } from './host.ts'
export { prompt } from './prompt.ts'
