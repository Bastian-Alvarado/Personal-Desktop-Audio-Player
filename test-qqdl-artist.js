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
    
    // Find the first track's artist ID
    let artistId = null;
    let artistName = null;
    for (const track of searchRes.data.items) {
        if (track.artist && track.artist.id) {
            artistId = track.artist.id;
            artistName = track.artist.name;
            break;
        }
    }
    
    console.log(`Found Artist ID: ${artistId} (${artistName})`);
    
    if (artistId) {
        console.log("Testing /artist/...");
        const artistRes = await fetchJson(`https://wolf.qqdl.site/artist/?id=${artistId}`);
        console.log("Artist Data keys:", artistRes.data ? Object.keys(artistRes.data) : artistRes);
        
        console.log("Testing /artist/albums/...");
        const albumsRes = await fetchJson(`https://wolf.qqdl.site/artist/albums/?id=${artistId}`);
        console.log("Albums Items count:", albumsRes.data && albumsRes.data.items ? albumsRes.data.items.length : albumsRes);
        
        console.log("Testing /artist/toptracks/...");
        const tracksRes = await fetchJson(`https://wolf.qqdl.site/artist/toptracks/?id=${artistId}`);
        console.log("Top Tracks Items count:", tracksRes.data && tracksRes.data.items ? tracksRes.data.items.length : tracksRes);
    }
}

run();
