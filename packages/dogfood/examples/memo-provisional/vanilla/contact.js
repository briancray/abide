// THE GATE, null until the answer lands. `null?.readOnly` is falsy,
// so the first button is live for as long as there is no answer —
// the frame the abide arm paints before `disabled` has a value.
let viewer = null

function mode(gate) {
    return gate?.readOnly ? 'locked' : 'editable'
}

function render() {
    document.querySelector('#mode').disabled = mode(viewer) === 'locked'
    // The other arm has nothing to branch on until the gate lands,
    // and says so rather than guessing.
    document.querySelector('#guarded').disabled =
        viewer === null || mode(viewer) === 'locked'
}

render()

fetch('/api/viewer')
    .then((response) => response.json())
    .then((answer) => {
        viewer = answer
        render()
    })
