const https = require('https');

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) return resolve({ error: `Status ${res.statusCode}`, url });
                try {
                    resolve(JSON.parse(data));
                } catch(e) { resolve({ error: 'Parse Error', data }); }
            });
        }).on('error', reject);
    });
}

async function run() {
    console.log("Searching for artist...");
    const searchRes = await fetchJson('https://wolf.qqdl.site/search/?s=cuco');
    if (!searchRes || !searchRes.data || !searchRes.data.items) {
        console.log("Search failed or unexpected format:", searchRes);
        return;
    }
    
    console.log(`Total Search Items: ${searchRes.data.items.length}`);
    const artistTracks = searchRes.data.items.filter(t => t.artist && t.artist.name.toLowerCase() === 'cuco');
    console.log(`Tracks by Cuco: ${artistTracks.length}`);
    
    const albums = new Set();
    artistTracks.forEach(t => {
        if (t.album) albums.add(t.album.title);
    });
    console.log(`Unique Albums:`, Array.from(albums));
}

run();
