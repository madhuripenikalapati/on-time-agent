// Web Push without a payload: the push only wakes the phone's service worker, which then
// fetches the household to see who is calling. No message encryption is needed, just a
// VAPID token (RFC 8292) signed with Node's built-in crypto.
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

const b64url = buffer => Buffer.from(buffer).toString('base64url');

export function generateVapidKeys() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publicKey = b64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]));
  return { publicKey, privateKey: jwk.d };
}

function vapidToken(endpoint, { publicKey, privateKey }, subject, now = Date.now()) {
  const point = Buffer.from(publicKey, 'base64url');
  const key = createPrivateKey({ format: 'jwk', key: {
    kty: 'EC', crv: 'P-256', d: privateKey, x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33, 65)),
  } });
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const signature = sign('sha256', Buffer.from(header + '.' + claims), { key, dsaEncoding: 'ieee-p1363' });
  return header + '.' + claims + '.' + b64url(signature);
}

const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com)\//i;
export const isPushEndpoint = endpoint => typeof endpoint === 'string' && endpoint.length < 1000 && PUSH_HOSTS.test(endpoint);

/** @returns {'sent'|'gone'|'failed'} gone = the subscription expired and should be removed */
export async function sendPush(endpoint, vapid, subject) {
  if (!vapid?.publicKey || !isPushEndpoint(endpoint)) return 'failed';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(6000),
      headers: {
        TTL: '120',
        Urgency: 'high',
        'Content-Length': '0',
        Authorization: 'vapid t=' + vapidToken(endpoint, vapid, subject) + ', k=' + vapid.publicKey,
      },
    });
    if (response.status === 404 || response.status === 410) return 'gone';
    if (!response.ok) console.error('Push failed', response.status, (await response.text().catch(() => '')).slice(0, 200));
    return response.ok ? 'sent' : 'failed';
  } catch (error) {
    console.error('Push failed', error.message);
    return 'failed';
  }
}

// Ring every phone registered to this household; drop subscriptions that have expired.
export async function ringPhones(doc, vapid, subject) {
  const results = await Promise.all((doc.push ?? []).map(async sub => [sub.endpoint, await sendPush(sub.endpoint, vapid, subject)]));
  return { sent: results.filter(([, r]) => r === 'sent').length, gone: results.filter(([, r]) => r === 'gone').map(([e]) => e) };
}
