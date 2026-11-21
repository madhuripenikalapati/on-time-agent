import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { interpretReply } from './openai.mjs';

const key = process.env.OPENAI_API_KEY;
const root = new URL('./dist/', import.meta.url);
const files = await readdir(root, {recursive:true});
const assetNames = files.filter(name => /\.(html|css|mjs|txt|m4a)$/u.test(name));
const assets = new Map(assetNames.map(name => ['/' + name, new URL(name, root)]));
assets.set('/', assets.get('/index.html'));
const mime = {html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',mjs:'text/javascript; charset=utf-8',txt:'text/plain; charset=utf-8',m4a:'audio/mp4'};
const phases = new Set(['explaining','meal','dose','pack']);
createServer(async (request,response) => {
  try {
    const path = new URL(request.url,'http://localhost').pathname;
    if (path === '/api/status' && request.method === 'GET') {
      return response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({openai:Boolean(key)}));
    }
    if (path === '/api/interpret' && request.method === 'POST') {
      if (!['http://localhost:8091','http://127.0.0.1:8091'].includes(request.headers.origin)) return response.writeHead(403).end();
      if (!key) return response.writeHead(503).end();
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 4096) return response.writeHead(413).end();
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch { return response.writeHead(400).end(); }
      if (!phases.has(data?.phase) || typeof data.reply !== 'string' || !data.reply.trim() || data.reply.length > 240) {
        return response.writeHead(400).end();
      }
      const action = await interpretReply(data,key,process.env.OPENAI_MODEL || undefined);
      return response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({action}));
    }
    const asset = assets.get(path);
    if (request.method !== 'GET' || !asset) return response.writeHead(404).end();
    const content = await readFile(asset);
    return response.writeHead(200,{'Content-Type':mime[asset.pathname.split('.').at(-1)] || 'application/octet-stream'}).end(content);
  } catch (error) {
    console.error(error.message);
    response.writeHead(502).end('Unable to interpret this reply.');
  }
}).listen(8091,'127.0.0.1',() => console.log('On Time Agent: http://localhost:8091'));
