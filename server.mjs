// Local development server: http://localhost:8091
// Reads OPENAI_API_KEY from .env (never committed). Data lives in .data/.
import { createServer } from 'node:http';
import { handleApi } from './lib/api.mjs';
import { serveStatic, securityHeaders } from './lib/static.mjs';
import { fileStore } from './lib/store.mjs';

try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch {}
const key = process.env.OPENAI_API_KEY;
const store = fileStore(new URL('./.data/', import.meta.url));
const port = Number(process.env.PORT) || 8091;

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    let result;
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 3_500_000) { response.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      result = await handleApi({
        method: request.method,
        path: url.pathname,
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }, { store, key });
    } else if (request.method === 'GET') {
      result = await serveStatic(url.pathname);
    }
    result ??= { status: 404, headers: {}, body: 'Not found' };
    response.writeHead(result.status, { ...securityHeaders, ...result.headers }).end(result.body);
  } catch (error) {
    console.error(error);
    response.writeHead(500).end('Server error');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`On Time Agent: http://localhost:${port}  (OpenAI key ${key ? 'loaded' : 'MISSING — add it to .env'})`);
});
