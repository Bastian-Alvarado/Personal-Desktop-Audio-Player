const fs = require('fs');
const content = fs.readFileSync('renderer.js', 'utf8');
const lines = content.split('\n');
let brBalance = 0;
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cleanLine = line.replace(/\/\/.*|\/\*.*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '');
    const opens = (cleanLine.match(/\{/g) || []).length;
    const closes = (cleanLine.match(/\}/g) || []).length;
    brBalance += opens - closes;
    if (brBalance < 0) {
        console.log(`Balance went NEGATIVE at line ${i + 1}: ${line}`);
        process.exit(1);
    }
}
console.log(`Final balance: ${brBalance}`);
if (brBalance !== 0) {
    console.log('Searching for where it went wrong...');
}
