/**
 * The header an early call of a streaming `GET` is made with (16.97): the answer is handed to the
 * socket mux after its first chunk rather than held open over http.
 */
export const CONTINUE_HEADER = 'abide-continue'
