const unitContainer = document.getElementById("unit-container");
const counterTpl = document.getElementById('counter-tpl');
const rowTpl = document.getElementById('row-tpl');

function createUnitRow(unitName) {
    // Create defender counter
    const defenderCounter = counterTpl.content.cloneNode(true);
    defenderCounter.querySelector('.count').textContent = 0

    // Create attacker counter
    const attackerCounter = counterTpl.content.cloneNode(true);
    attackerCounter.querySelector('.count').textContent = 0

    // Build row
    const rowFragment = rowTpl.contentEditable.cloneNode(true);
    rowFragment.querySelector('.unit-name').textContent = unitName;
    rowFragment.querySelector('.defender-counter').appendChild(defenderCounter);
    rowFragment.querySelector('.attacker-counter').appendChild(attackerCounter);

    // Add row to unit container
    unitContainer.appendChild(rowFragment)
}
