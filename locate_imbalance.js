const fs = require('fs');
const lines = fs.readFileSync('renderer.js', 'utf8').split('\n');
let balance = 0;
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    balance += opens - closes;
    if (balance < 0) {
        console.log(`Balance went negative at line ${i + 1}: ${line}`);
        process.exit(1);
    }
}
console.log(`Final balance: ${balance}`);
if (balance !== 0) {
    console.log('Final balance is not zero!');
}
