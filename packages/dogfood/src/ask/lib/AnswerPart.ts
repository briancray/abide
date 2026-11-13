/**
 * What the answer bar renders in place of a `<show …/>` line Claude writes: one kind of rendering and
 * what it renders. `from` narrows a `code` to the construct a line prefix opens (40.7).
 */
export type Show =
    | { kind: 'example'; value: string }
    | { kind: 'code'; value: string; from: string | undefined }
    | { kind: 'name'; value: string }
    | { kind: 'clause'; value: string }
    | { kind: 'results'; value: string }
    | { kind: 'page'; value: string }
    | { kind: 'open'; value: string }

/** One block of an answer, rendered on the server: prose as HTML, a fence as code, or a `<show/>`. */
export type AnswerPart =
    | { kind: 'html'; html: string }
    | { kind: 'code'; language: string; code: string }
    | { kind: 'show'; show: Show }

/** What `answer` streams: a finished block, the block being written, a docs tool called, the end. */
export type AnswerEvent =
    | { type: 'part'; part: AnswerPart }
    | { type: 'tail'; part: AnswerPart | undefined }
    | { type: 'tool'; name: string }
    | { type: 'done'; text: string; stop: string }
