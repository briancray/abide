// A COMPONENT IS A FUNCTION HERE, AND A PROP IS ITS ARGUMENT — which
// makes the prop a SNAPSHOT. Staying live means handing the child a way
// to READ rather than a value, and then remembering to tell it when to.
// The parent ends up owning the child's update.
function Total(read, currency = 'USD') {
    const node = document.createElement('strong')
    const update = () => {
        node.textContent = `${currency} ${read().toFixed(2)}`
    }
    update()
    return { node, update }
}

let lines = 2

const total = Total(() => lines * 620)
document.querySelector('#total').append(total.node)

function render() {
    document.querySelector('#lines').textContent = String(lines)
    total.update()
}

document.querySelector('#more').addEventListener('click', () => {
    lines += 1
    render()
})

document.querySelector('#fewer').addEventListener('click', () => {
    lines = Math.max(1, lines - 1)
    render()
})

render()
