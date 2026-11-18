/* Local preview: serves public/ and the same /api/sets logic as production,
   with the "database" kept in .local-data/sets.json.   Run:  npm start  */

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSetsHandler } from './server/sets-core.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// The password comes from .env (see .env.example) or the environment
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch (e) { /* no .env file */ }
if (!process.env.SITE_PASSWORD) {
    console.warn('SITE_PASSWORD is not set — copy .env.example to .env, otherwise nobody can log in.');
}
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, '.local-data');
const DATA_FILE = path.join(DATA_DIR, 'sets.json');
const PORT = Number(process.env.PORT) || 8155;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const handleSets = createSetsHandler({
    password: () => process.env.SITE_PASSWORD,
    loadDoc: async () => {
        try { return JSON.parse(await readFile(DATA_FILE, 'utf8')); } catch (e) { return null; }
    },
    saveDoc: async doc => {
        await mkdir(DATA_DIR, { recursive: true });
        await writeFile(DATA_FILE, JSON.stringify(doc, null, 2));
    }
});

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
}

http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
        if (url.pathname === '/api/sets') {
            const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
            const response = await handleSets(new Request(url, {
                method: req.method,
                headers: req.headers,
                body: hasBody ? await readBody(req) : undefined
            }));
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(await response.text());
            return;
        }

        const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
        const file = path.join(PUBLIC_DIR, rel);
        if (!file.startsWith(PUBLIC_DIR + path.sep)) {
            res.writeHead(403);
            res.end();
            return;
        }
        const data = await readFile(file);
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        res.end(data);
    } catch (err) {
        res.writeHead(err.code === 'ENOENT' || err.code === 'EISDIR' ? 404 : 500);
        res.end();
    }
}).listen(PORT, '127.0.0.1', () => {
    console.log('Table Topics running at http://127.0.0.1:' + PORT);
});
