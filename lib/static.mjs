// Serves the browser app from dist/ with security headers, for both local and Lambda.
import { readFile } from 'node:fs/promises';

const root = new URL('../dist/', import.meta.url);
const types = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  js: 'text/javascript; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', txt: 'text/plain; charset=utf-8',
  woff2: 'font/woff2', webmanifest: 'application/manifest+json',
};
const binary = new Set(['png', 'jpg', 'webp', 'ico', 'woff2']);

export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'microphone=(self), camera=(self)',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self' https://api.openai.com",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '),
};

export async function serveStatic(path) {
  const name = path === '/' ? 'index.html' : decodeURIComponent(path).replace(/^\/+/, '');
  if (!/^[A-Za-z0-9_\-/]+\.[a-z0-9]+$/.test(name) || name.includes('..')) return null;
  const ext = name.split('.').at(-1);
  if (!types[ext]) return null;
  try {
    const content = await readFile(new URL(name, root));
    return {
      status: 200,
      headers: {
        'Content-Type': types[ext],
        'Cache-Control': 'no-cache',
      },
      body: content,
      binary: binary.has(ext),
    };
  } catch {
    return null;
  }
}
