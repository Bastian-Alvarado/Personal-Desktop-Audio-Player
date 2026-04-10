const https = require('https');

https.get('https://wolf.qqdl.site/track/?id=1225577', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
         console.log('Track Response:', data);
         try {
             const json = JSON.parse(data);
             const decoded = Buffer.from(json.manifest || json.data, 'base64').toString('utf8');
             console.log('Decoded:', decoded);
         } catch(e) { console.error('Decode failed', e.message); }
    });
});
