const https = require('https');

const fetchQQDL = (path) => new Promise((resolve) => {
    https.get(`https://wolf.qqdl.site${path}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
    });
});

async function run() {
    console.log("Checking Search for Cuco...");
    const searchData = await fetchQQDL('/search/?s=cuco');
    const parsed = JSON.parse(searchData);
    const cucoTrack = parsed.data.items.find(t => t.artist.name.toLowerCase() === 'cuco');
    console.log("\nFull Track Object:");
    console.dir(cucoTrack, { depth: null });

    if (cucoTrack) {
        if (cucoTrack.artist && cucoTrack.artist.id) {
            console.log("\nChecking /artist/" + cucoTrack.artist.id + "/albums...");
            const albumsResponse = await fetchQQDL(`/artist/${cucoTrack.artist.id}/albums`);
            console.log("Artist Albums Response:", albumsResponse.substring(0, 300));
        }

        if (cucoTrack.album && cucoTrack.album.id) {
            console.log("\nChecking /album/" + cucoTrack.album.id + " ...");
            const albumInfo = await fetchQQDL(`/album/${cucoTrack.album.id}`);
            console.log("Album Info Response:", albumInfo.substring(0, 300));
            
            console.log("\nChecking /album/" + cucoTrack.album.id + "/tracks ...");
            const albumTracks = await fetchQQDL(`/album/${cucoTrack.album.id}/tracks`);
            console.log("Album Tracks Response:", albumTracks.substring(0, 300));
        }
    }
}

run();
