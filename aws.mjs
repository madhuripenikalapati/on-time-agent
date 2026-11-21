// Lambda entry point behind an API Gateway HTTP API.
// The OpenAI key comes from Secrets Manager; households live in DynamoDB.
import { handleApi } from './lib/api.mjs';
import { serveStatic, securityHeaders } from './lib/static.mjs';
import { dynamoStore } from './lib/store.mjs';
import { runScheduler } from './lib/scheduler.mjs';

let secretPromise;
let secretExpiry = 0;
async function secrets() {
  if (!secretPromise || Date.now() >= secretExpiry) {
    secretExpiry = Date.now() + 5 * 60_000;
    secretPromise = (async () => {
      const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
      const response = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: process.env.SECRET_ARN }));
      const data = JSON.parse(response.SecretString);
      if (typeof data.OPENAI_API_KEY !== 'string' || !data.OPENAI_API_KEY.startsWith('sk-')) throw new Error('OPENAI_API_KEY missing from secret');
      const vapid = data.VAPID_PUBLIC_KEY && data.VAPID_PRIVATE_KEY ? { publicKey: data.VAPID_PUBLIC_KEY, privateKey: data.VAPID_PRIVATE_KEY } : null;
      return { key: data.OPENAI_API_KEY, vapid };
    })().catch(error => { secretPromise = undefined; throw error; });
  }
  return secretPromise;
}

let storePromise;
const store = () => (storePromise ??= dynamoStore(process.env.TABLE_NAME));

const PUSH_SUBJECT = process.env.PUSH_SUBJECT || 'https://example.com/on-time';

export async function handler(event) {
  // Every minute: ring phones whose medicine time (or follow-up) has come.
  if (event.source === 'aws.events' || event['detail-type'] === 'Scheduled Event') {
    const { vapid } = await secrets();
    const rang = await runScheduler(await store(), { vapid, origin: PUSH_SUBJECT });
    if (rang) console.log('Scheduler rang', rang, 'phone(s)');
    return { rang };
  }
  try {
    const method = event.requestContext?.http?.method;
    const path = event.rawPath;
    let result;
    if (path.startsWith('/api/')) {
      const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      const body = event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8').toString('utf8') : '';
      const { key, vapid } = await secrets();
      result = await handleApi({ method, path, headers, body }, { store: await store(), key, vapid, origin: PUSH_SUBJECT });
    } else if (method === 'GET') {
      result = await serveStatic(path);
    }
    result ??= { status: 404, headers: {}, body: 'Not found' };
    const isBuffer = Buffer.isBuffer(result.body);
    return {
      statusCode: result.status,
      headers: { ...securityHeaders, 'Strict-Transport-Security': 'max-age=31536000', ...result.headers },
      body: isBuffer ? result.body.toString(result.binary ? 'base64' : 'utf8') : result.body,
      isBase64Encoded: Boolean(isBuffer && result.binary),
    };
  } catch (error) {
    console.error(error.message);
    return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: '{"error":"Service temporarily unavailable."}' };
  }
}
