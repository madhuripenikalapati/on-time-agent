// Household storage with optimistic concurrency, plus a simple daily quota counter.
// fileStore is for local development; dynamoStore is used on AWS.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

export class Conflict extends Error {}

export function fileStore(directory) {
  const path = id => new URL(id + '.json', directory);
  const counters = new Map();
  let chain = Promise.resolve();
  const serial = task => (chain = chain.then(task, task));
  return {
    async get(id) {
      try { return JSON.parse(await readFile(path(id), 'utf8')); } catch { return null; }
    },
    put(doc, expectedVersion) {
      return serial(async () => {
        await mkdir(directory, { recursive: true });
        const current = await this.get(doc.id);
        if ((current?.version ?? 0) !== expectedVersion) throw new Conflict();
        const next = { ...doc, version: expectedVersion + 1 };
        const temp = new URL(doc.id + '.tmp', directory);
        await writeFile(temp, JSON.stringify(next));
        await rename(temp, path(doc.id));
        return next;
      });
    },
    async putBlob(key, value) {
      await mkdir(directory, { recursive: true });
      await writeFile(new URL(key.replace(/[^A-Za-z0-9_-]/g, '_') + '.blob', directory), value);
    },
    async getBlob(key) {
      try { return await readFile(new URL(key.replace(/[^A-Za-z0-9_-]/g, '_') + '.blob', directory), 'utf8'); } catch { return null; }
    },
    async quota(name, limit) {
      const used = (counters.get(name) ?? 0) + 1;
      counters.set(name, used);
      return used <= limit;
    },
  };
}

export async function dynamoStore(table) {
  const { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb');
  const client = new DynamoDBClient({});
  return {
    async get(id) {
      const result = await client.send(new GetItemCommand({ TableName: table, Key: { id: { S: id } }, ConsistentRead: true }));
      return result.Item ? JSON.parse(result.Item.doc.S) : null;
    },
    async put(doc, expectedVersion) {
      const next = { ...doc, version: expectedVersion + 1 };
      try {
        await client.send(new PutItemCommand({
          TableName: table,
          Item: {
            id: { S: doc.id },
            doc: { S: JSON.stringify(next) },
            v: { N: String(next.version) },
            expires: { N: String(Math.floor(Date.now() / 1000) + 30 * 86400) },
          },
          ConditionExpression: expectedVersion === 0 ? 'attribute_not_exists(id)' : 'v = :v',
          ExpressionAttributeValues: expectedVersion === 0 ? undefined : { ':v': { N: String(expectedVersion) } },
        }));
      } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') throw new Conflict();
        throw error;
      }
      return next;
    },
    async putBlob(key, value) {
      await client.send(new PutItemCommand({
        TableName: table,
        Item: { id: { S: key }, data: { S: value }, expires: { N: String(Math.floor(Date.now() / 1000) + 30 * 86400) } },
      }));
    },
    async getBlob(key) {
      const result = await client.send(new GetItemCommand({ TableName: table, Key: { id: { S: key } } }));
      return result.Item?.data?.S ?? null;
    },
    async quota(name, limit) {
      try {
        await client.send(new UpdateItemCommand({
          TableName: table,
          Key: { id: { S: 'quota#' + name } },
          UpdateExpression: 'ADD used :one SET expires = if_not_exists(expires, :exp)',
          ConditionExpression: 'attribute_not_exists(used) OR used < :limit',
          ExpressionAttributeValues: {
            ':one': { N: '1' },
            ':limit': { N: String(limit) },
            ':exp': { N: String(Math.floor(Date.now() / 1000) + 2 * 86400) },
          },
        }));
        return true;
      } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') return false;
        throw error;
      }
    },
  };
}

// Read-modify-write with retries on concurrent updates.
export async function update(store, id, change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = await store.get(id);
    if (!doc) return null;
    const version = doc.version ?? 0;
    const result = await change(doc);
    doc.updatedAt = Date.now();
    try {
      const saved = await store.put(doc, version);
      return { doc: saved, result };
    } catch (error) {
      if (!(error instanceof Conflict)) throw error;
    }
  }
  throw new Error('Too many concurrent updates.');
}
