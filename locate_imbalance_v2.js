const fs = require('fs');
const content = fs.readFileSync('renderer.js', 'utf8');
const lines = content.split('\n');
let brBalance = 0;
let parBalance = 0;
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Remove comments and strings for better count
    const cleanLine = line.replace(/\/\/.*|\/\*.*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '');
    
    const opens = (cleanLine.match(/\{/g) || []).length;
    const closes = (cleanLine.match(/\}/g) || []).length;
    brBalance += opens - closes;
    
    const pOpens = (cleanLine.match(/\(/g) || []).length;
    const pCloses = (cleanLine.match(/\)/g) || []).length;
    parBalance += pOpens - pCloses;

    if (brBalance < 0) {
        console.log(`Brace balance went negative at line ${i + 1}: ${line}`);
    }
    if (parBalance < 0) {
        console.log(`Paren balance went negative at line ${i + 1}: ${line}`);
    }
}
console.log(`Final Brace Balance: ${brBalance}`);
console.log(`Final Paren Balance: ${parBalance}`);
