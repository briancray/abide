/**
 * What a build stops on: the refusals it met, each as the line `abide check` prints it (38.139).
 *
 * Told apart from a throw nobody meant, which keeps its stack: a command prints this one's message
 * and fails, where a crash in the compiler is still read off the frames that threw it.
 */
export class BuildRefusal extends Error {}
