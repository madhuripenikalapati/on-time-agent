#!/bin/sh
# Packages only the app code for Lambda. Never copies .env or local data.
set -eu
cd "$(dirname "$0")/.."
rm -rf build on-time-agent-deploy.zip
mkdir -p build
cp aws.mjs build/
cp -R lib dist build/
rm -rf build/dist/_test
node --test test/*.test.mjs >/dev/null
if grep -rqE 'sk-[A-Za-z0-9_-]{20,}' build; then echo "Refusing to package: found something that looks like an API key" >&2; exit 1; fi
zip -qr on-time-agent-deploy.zip template.yaml build
echo "Built build/ and on-time-agent-deploy.zip ($(du -h on-time-agent-deploy.zip | cut -f1))"
