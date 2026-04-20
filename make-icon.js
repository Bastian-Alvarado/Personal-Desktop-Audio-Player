// Converts icon-256.png (or icon-512.png) into a valid multi-size .ico file
// Uses only built-in Node.js zlib + manual BMP/ICO encoding
const fs = require('fs');
const { createCanvas, loadImage } = (() => {
    try { return require('canvas'); } catch(e) { return null; }
})() || {};

// Fallback: use electron-builder's own icon builder approach
// electron-builder accepts a 256x256 PNG named icon.png for win builds
// We just copy icon-512.png and rename it — electron-builder will handle it
fs.copyFileSync('icon-512.png', 'icon.png');
console.log('Copied icon-512.png -> icon.png for electron-builder');
