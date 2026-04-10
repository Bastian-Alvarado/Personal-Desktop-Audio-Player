const https = require('https');

https.get('https://wolf.qqdl.site/search/?s=cuco', { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const parsed = JSON.parse(data);
            const tracks = parsed.data.items;
            const cucoTrack = tracks.find(t => t.artist.name.toLowerCase() === 'cuco');
            console.log("Artist Object from Search Track:");
            console.log(cucoTrack.artist);
        } catch(e) { console.error('Parse error'); }
    });
});
