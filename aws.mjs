import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { interpretReply } from './openai.mjs';
import { extractPrescription, maxPrescriptionBody } from './prescription.mjs';

const phases = new Set(['explaining','meal','dose','pack']);
const root = new URL('./dist/', import.meta.url);
const assets = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/style.css','style.css'],
  ['/app.mjs','app.mjs'], ['/logic.mjs','logic.mjs'], ['/audio-lines.mjs','audio-lines.mjs'],
  ['/sample-prescription.txt','sample-prescription.txt'],
  ...['breakfast','callback','dinner','dose','intro','later','lunch','mismatch','pack','taken','unconfirmed']
    .map(name => ['/audio/' + name + '.m4a', 'audio/' + name + '.m4a'])
]);
const mime = {html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',mjs:'text/javascript; charset=utf-8',txt:'text/plain; charset=utf-8',m4a:'audio/mp4'};
const headers = {
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
  'Permissions-Policy':'microphone=(self), camera=()',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; object-src blob:; media-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};
const reply = (statusCode, body = '', extra = {}) => ({statusCode, headers:{...headers,...extra}, body});
const json = (status, data) => reply(status,JSON.stringify(data),{'Content-Type':'application/json'});
let secretPromise;
let secretExpiry = 0;
async function readSecret() {
  if (!secretPromise || Date.now() >= secretExpiry) {
    secretExpiry = Date.now() + 60000;
    secretPromise = (async () => {
      const {SecretsManagerClient, GetSecretValueCommand} = await import('@aws-sdk/client-secrets-manager');
      const client = new SecretsManagerClient({});
      const response = await client.send(new GetSecretValueCommand({SecretId:process.env.PILOT_SECRET_ARN}));
      const data = JSON.parse(response.SecretString);
      if (typeof data.OPENAI_API_KEY !== 'string' || typeof data.PILOT_PASSWORD !== 'string' || data.PILOT_PASSWORD.length < 24) {
        throw new Error('Pilot secret is incomplete');
      }
      return data;
    })().catch(error => { secretPromise = undefined; throw error; });
  }
  return secretPromise;
}
function authenticated(value,password) {
  if (!value?.startsWith('Basic ') || value.length > 2048) return false;
  const supplied = Buffer.from(value.slice(6),'base64');
  const expected = Buffer.from('pilot:' + password);
  return supplied.length === expected.length && timingSafeEqual(supplied,expected);
}

export function createHandler(secretLoader = readSecret, interpreter = interpretReply) {
  return async event => {
    try {
      const request = event.requestContext;
      const method = request?.http?.method;
      const path = event.rawPath;
      const incoming = event.headers ?? {};
      if (!((method === 'GET' && (assets.has(path) || path === '/api/status')) ||
            (method === 'POST' && ['/api/interpret','/api/prescription'].includes(path)))) return reply(404);
      if (!incoming.authorization) return reply(401,'Sign in to the synthetic pilot.',{'WWW-Authenticate':'Basic realm="On Time Agent Pilot", charset="UTF-8"'});
      const secret = await secretLoader();
      if (!authenticated(incoming.authorization,secret.PILOT_PASSWORD)) {
        return reply(401,'Sign in to the synthetic pilot.',{'WWW-Authenticate':'Basic realm="On Time Agent Pilot", charset="UTF-8"'});
      }
      if (path === '/api/status') return json(200,{openai:true,prescription:true});
      if (path === '/api/interpret' || path === '/api/prescription') {
        const extraction = path === '/api/prescription';
        const limit = extraction ? maxPrescriptionBody : 4096;
        if (incoming.origin !== 'https://' + request.domainName) return json(403,{error:'Open the pilot page to interpret a reply.'});
        if (!/^application\/json(?:\s*;|$)/i.test(incoming['content-type'] ?? '')) return json(415,{error:'Expected JSON.'});
        if (typeof event.body !== 'string' || event.body.length > limit * 2) return json(413,{error:'Reply too large.'});
        const buffer = Buffer.from(event.body,event.isBase64Encoded ? 'base64' : 'utf8');
        if (buffer.length > limit) return json(413,{error:'Reply too large.'});
        let data;
        try { data = JSON.parse(buffer.toString('utf8')); } catch { return json(400,{error:'Invalid JSON.'}); }
        if (extraction) {
          try { return json(200,await extractPrescription(data?.files,secret.OPENAI_API_KEY)); }
          catch (error) { if (error instanceof TypeError) return json(400,{error:error.message}); throw error; }
        }
        if (!phases.has(data?.phase) || typeof data.reply !== 'string' || !data.reply.trim() || data.reply.length > 240) {
          return json(400,{error:'A short reply and valid phase are required.'});
        }
        const action = await interpreter({reply:data.reply,phase:data.phase},secret.OPENAI_API_KEY,process.env.OPENAI_MODEL || undefined);
        return json(200,{action});
      }
      const name = assets.get(path);
      const ext = name.split('.').at(-1);
      const content = await readFile(new URL(name,root));
      const result = reply(200,content.toString(ext === 'm4a' ? 'base64' : 'utf8'),{'Content-Type':mime[ext]});
      return ext === 'm4a' ? {...result,isBase64Encoded:true} : result;
    } catch {
      return json(502,{error:'The pilot service is temporarily unavailable.'});
    }
  };
}
export const handler = createHandler();
