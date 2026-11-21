// Lambda entry point behind an API Gateway HTTP API.
// The OpenAI key comes from Secrets Manager; households live in DynamoDB.
import { handleApi } from './lib/api.mjs';
import { serveStatic, securityHeaders } from './lib/static.mjs';
import { dynamoStore } from './lib/store.mjs';

let secretPromise;
let secretExpiry = 0;
async function openaiKey() {
  if (!secretPromise || Date.now() >= secretExpiry) {
    secretExpiry = Date.now() + 5 * 60_000;
    secretPromise = (async () => {
      const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
      const response = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: process.env.SECRET_ARN }));
      const key = JSON.parse(response.SecretString).OPENAI_API_KEY;
      if (typeof key !== 'string' || !key.startsWith('sk-')) throw new Error('OPENAI_API_KEY missing from secret');
      return key;
    })().catch(error => { secretPromise = undefined; throw error; });
  }
  return secretPromise;
}

let storePromise;
const store = () => (storePromise ??= dynamoStore(process.env.TABLE_NAME));

export async function handler(event) {
  try {
    const method = event.requestContext?.http?.method;
    const path = event.rawPath;
    let result;
    if (path.startsWith('/api/')) {
      const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      const body = event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8').toString('utf8') : '';
      result = await handleApi({ method, path, headers, body }, { store: await store(), key: await openaiKey() });
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
