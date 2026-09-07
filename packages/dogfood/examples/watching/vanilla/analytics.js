// The module the effect reports to, stubbed the way an app's own would be — the point of
// the arm is the teardown and the source list around it, not what analytics does.
export const analytics = {
    compose(topic, length) {
        console.info('compose', topic, length)
    },
}
