#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/Users/pedro/.local/toolchain/node/bin:$PATH"
# This entry point serves only loopback HTTP; remote production still requires HTTPS.
export ALLOW_INSECURE_LOCAL_HTTP="${ALLOW_INSECURE_LOCAL_HTTP:-true}"
if [[ ! -f .env.local ]]; then
  npm run setup
fi
npm run db:up -- --wait --wait-timeout 60
npm run db:migrate
npm run seed
npm run build
exec npm run start
