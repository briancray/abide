// One `TextEncoder` for the process.
//
// Its own leaf because both seams want it and neither may reach the other's: `#server`'s response
// path had one and reasoned about it, `#shared`'s `framedBody` built a fresh one per response body,
// and the side that had done the thinking was the side the other could not import.
//
// Stateless — `encode` reads nothing off it — so one instance is the whole of what a process needs.
export const ENCODER = new TextEncoder()
