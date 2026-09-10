// THE GATE, and it is null until the answer lands — which is the
// whole of what this card is about, because `null?.readOnly` is
// undefined and undefined is falsy.
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
