const https = require('https');

function fetchUrl(url) {
    return new Promise((resolve) => {
        https.get(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            } 
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: data.substring(0, 1500) }));
        }).on('error', (e) => resolve({ error: e.message }));
    });
}

async function run() {
    // The wolf proxy redirected to qqdl.site - let's check the redirect location
    console.log("=== Checking where qqdl.site/artist redirects ===");
    
    // Try all known worker subdomains
    const workers = ['wolf', 'fox', 'bear', 'eagle'];
    for (const w of workers) {
        const url = `https://${w}.qqdl.site`;
        console.log(`\nChecking ${url}/ ...`);
        const r = await fetchUrl(url + '/');
        console.log('Status:', r.status);
        if (r.data) console.log('Response preview:', r.data.substring(0, 200));
    }

    console.log("\n=== Checking QQDL for available routes ===");
    const routes = [
        '/tracks/4363249',
        '/artists/4363249', 
        '/artists/4363249/albums',
        '/artist/4363249/discography',
        '/v1/artist/4363249/albums',
        '/api/v1/artist/4363249',
    ];
    for (const route of routes) {
        const r = await fetchUrl(`https://wolf.qqdl.site${route}`);
        console.log(`${route} -> ${r.status}: ${r.data ? r.data.substring(0, 80) : 'n/a'}`);
    }
}

run();
