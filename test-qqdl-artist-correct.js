const https = require('https');

function fetchUrl(url) {
    return new Promise((resolve) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        }).on('error', (e) => resolve({ error: e.message }));
    });
}

async function run() {
    // CORRECT syntax: /artist/?id=<id> for metadata, /artist/?f=<id> for full discography
    const ARTIST_ID = 4363249; // Cuco

    console.log("=== GET /artist/?id=4363249 (basic metadata) ===");
    const r1 = await fetchUrl(`https://wolf.qqdl.site/artist/?id=${ARTIST_ID}`);
    console.log("Status:", r1.status);
    try { console.log(JSON.stringify(JSON.parse(r1.data), null, 2).substring(0, 800)); } catch(e) { console.log(r1.data.substring(0,400)); }

    console.log("\n=== GET /artist/?f=4363249&skip_tracks=true  (albums/singles, no track fetching) ===");
    const r2 = await fetchUrl(`https://wolf.qqdl.site/artist/?f=${ARTIST_ID}&skip_tracks=true`);
    console.log("Status:", r2.status);
    try { 
        const parsed = JSON.parse(r2.data);
        const albums = parsed.albums?.items || [];
        console.log(`Found ${albums.length} albums/singles`);
        albums.slice(0, 5).forEach(a => console.log(` - [${a.type || 'ALBUM'}] ${a.title} (id: ${a.id})`));
        console.log("Top tracks:", (parsed.tracks || []).length);
    } catch(e) { console.log(r2.data.substring(0, 600)); }
    
    console.log("\n=== GET /album/?id=<albumId> (full album tracklist) ===");
    // Get first album ID from previous call and check its tracks
    const r2b = await fetchUrl(`https://wolf.qqdl.site/artist/?f=${ARTIST_ID}&skip_tracks=true`);
    try {
        const parsed = JSON.parse(r2b.data);
        const firstAlbum = (parsed.albums?.items || [])[0];
        if (firstAlbum) {
            console.log(`Testing album: "${firstAlbum.title}" (id: ${firstAlbum.id})`);
            const r3 = await fetchUrl(`https://wolf.qqdl.site/album/?id=${firstAlbum.id}`);
            console.log("Status:", r3.status);
            const albumParsed = JSON.parse(r3.data);
            const items = albumParsed.data?.items || [];
            console.log(`Tracks found: ${items.length}`);
            items.slice(0,5).forEach(t => console.log(` - ${t.item?.title || t.title}`));
        }
    } catch(e) { console.log("Error:", e.message); }
}

run();
