const field = document.querySelector('#rate')
const region = document.querySelector('#region')

function converted(rate) {
    const value = Number(rate)
    if (!(value > 0)) throw new Error('Rate must be a positive number.')
    return (1240 * value).toFixed(2)
}

function row(label, value) {
    const item = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = label
    const shown = document.createElement('strong')
    shown.textContent = value
    item.append(name, shown)
    return item
}

// THE REGION IS BUILT WHOLE OR NOT AT ALL, which is what the boundary
// costs by hand: build into a fragment, and only put it in the document
// once nothing in it has thrown. Appending as you go leaves the rows
// that were fine standing under the failure of the one that was not.
function render() {
    let built
    try {
        const list = document.createElement('ul')
        list.className = 'fields'
        list.append(row('invoice', '#4310'))
        list.append(row('converted', `$${converted(field.value)}`))
        built = list
    } catch (problem) {
        built = document.createElement('p')
        built.className = 'status'
        built.textContent = problem.message
    }
    region.replaceChildren(built)
}

field.addEventListener('input', render)

render()
