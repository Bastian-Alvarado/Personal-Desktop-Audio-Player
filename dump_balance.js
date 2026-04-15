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
    console.log(`${String(i + 1).padStart(4)} | Balance: ${String(brBalance).padStart(2)} | ${line.substring(0, 50)}`);
}
