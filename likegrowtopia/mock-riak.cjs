const http = require('http');
const url = require('url');

// In-memory storage for mock Riak
const buckets = new Map();

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // Ping endpoint
    if (path === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }
    
    // Stats endpoint
    if (path === '/stats') {
        const stats = {
            riak_kv_version: "2.9.10-mock",
            node_name: "riak@127.0.0.1",
            ring_creation_size: 64,
            buckets_count: buckets.size,
            memory_total: process.memoryUsage().heapTotal,
            memory_used: process.memoryUsage().heapUsed
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats, null, 2));
        return;
    }
    
    // Bucket/key operations: /buckets/{bucket}/keys/{key}
    const bucketKeyMatch = path.match(/^\/buckets\/([^\/]+)\/keys\/([^\/]+)$/);
    if (bucketKeyMatch) {
        const [, bucket, key] = bucketKeyMatch;
        
        if (!buckets.has(bucket)) {
            buckets.set(bucket, new Map());
        }
        const bucketData = buckets.get(bucket);
        
        if (req.method === 'GET') {
            const value = bucketData.get(key);
            if (value !== undefined) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ bucket, key, value }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'not_found' }));
            }
            return;
        }
        
        if (req.method === 'PUT' || req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const value = JSON.parse(body);
                    bucketData.set(key, value);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, bucket, key }));
                } catch (e) {
                    bucketData.set(key, body);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, bucket, key }));
                }
            });
            return;
        }
        
        if (req.method === 'DELETE') {
            const deleted = bucketData.delete(key);
            res.writeHead(deleted ? 200 : 404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ deleted, bucket, key }));
            return;
        }
    }
    
    // List keys: /buckets/{bucket}/keys
    const bucketMatch = path.match(/^\/buckets\/([^\/]+)\/keys$/);
    if (bucketMatch) {
        const [, bucket] = bucketMatch;
        const bucketData = buckets.get(bucket);
        const keys = bucketData ? Array.from(bucketData.keys()) : [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ bucket, keys }));
        return;
    }
    
    // List buckets
    if (path === '/buckets') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ buckets: Array.from(buckets.keys()) }));
        return;
    }
    
    // 404 for unknown paths
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', path }));
});

const PORT = 8000;
server.listen(PORT, () => {
    console.log(`Mock Riak KV server running on http://localhost:${PORT}`);
    console.log(`Available endpoints:`);
    console.log(`  GET  /ping`);
    console.log(`  GET  /stats`);
    console.log(`  GET  /buckets`);
    console.log(`  GET  /buckets/{bucket}/keys`);
    console.log(`  GET  /buckets/{bucket}/keys/{key}`);
    console.log(`  PUT  /buckets/{bucket}/keys/{key}`);
    console.log(`  DELETE /buckets/{bucket}/keys/{key}`);
});
