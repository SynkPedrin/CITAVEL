#!/usr/bin/env bash
# Controlled release with automatic rollback. Run on the production host from the repo root.
#   ./deploy/release.sh            → backup DB, build image tagged with the git commit, migrate (additive), switch, health-check
set -euo pipefail
cd "$(dirname "$0")"
REL=$(git rev-parse --short HEAD); PREV=$(cat .current_release 2>/dev/null || echo "")
STAMP=$(date +%Y%m%d-%H%M%S); mkdir -p backups && chmod 700 backups
echo "== backup database"; docker compose -f compose.prod.yml exec -T db pg_dump -U citavel -Fc citavel_manager > "backups/db-$STAMP-before-$REL.dump"
echo "== build $REL"; RELEASE=$REL docker compose -f compose.prod.yml build manager
echo "== schema (additive db push; aborts on data loss)"; RELEASE=$REL docker compose -f compose.prod.yml run --rm manager npx prisma db push --skip-generate
echo "== switch"; RELEASE=$REL docker compose -f compose.prod.yml up -d manager caddy
for i in $(seq 1 30); do sleep 2; docker compose -f compose.prod.yml exec -T manager node -e "fetch('http://127.0.0.1:3002/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && { echo "$REL" > .current_release; echo "healthy: $REL (previous: ${PREV:-none})"; exit 0; }; done
echo "!! health check failed — rolling back to ${PREV:-previous image}"
[ -n "$PREV" ] && RELEASE=$PREV docker compose -f compose.prod.yml up -d manager
exit 1
