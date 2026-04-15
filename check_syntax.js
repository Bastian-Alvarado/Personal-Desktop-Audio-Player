const fs = require('fs');
const content = fs.readFileSync('renderer.js', 'utf8');
try {
    new Function(content);
    console.log('No syntax error found by new Function()');
} catch (e) {
    console.log('Syntax Error found:');
    console.log(e.message);
    if (e.stack) {
        console.log(e.stack);
    }
}
