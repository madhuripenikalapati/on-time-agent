#!/bin/sh
# Builds, tests and deploys On Time to AWS in one command, then checks the live site.
# Uses the normal AWS credential chain (AWS_PROFILE, environment variables, or GitHub Actions).
set -eu
cd "$(dirname "$0")/.."
REGION="${AWS_REGION:-us-west-2}"
STACK="${STACK_NAME:-on-time-agent-pilot}"
SECRET="${SECRET_ID:-on-time-agent-pilot}"

./scripts/build.sh
ARN=$(aws secretsmanager describe-secret --region "$REGION" --secret-id "$SECRET" --query ARN --output text)
sam deploy --stack-name "$STACK" --capabilities CAPABILITY_IAM --resolve-s3 \
  --no-confirm-changeset --no-fail-on-empty-changeset --region "$REGION" \
  --parameter-overrides "PilotSecretArn=$ARN"

URL=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?contains(OutputKey, 'Url') || contains(OutputKey, 'URL')].OutputValue | [0]" --output text)
if [ -n "$URL" ] && [ "$URL" != "None" ]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "${URL%/}/api/status")
  echo "Live: $URL (status $CODE)"
  [ "$CODE" = "200" ]
fi
