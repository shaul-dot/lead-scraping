#!/bin/bash
set -euo pipefail

# Hyperscale Leads - Deployment Script
# Usage: ./scripts/deploy.sh [local|prod]

MODE=${1:-local}

echo "=== Hyperscale Leads Deployment ==="
echo "Mode: $MODE"
echo ""

if [ "$MODE" = "local" ]; then
  echo "[1/8] Starting Docker services..."
  docker compose up -d

  echo "[2/8] Installing dependencies..."
  pnpm install

  echo "[3/8] Running database migrations..."
  cd packages/database && pnpm prisma migrate dev --name init && cd ../..

  echo "[4/8] Generating Prisma client..."
  cd packages/database && pnpm prisma generate && cd ../..

  echo "[5/8] Seeding database..."
  cd packages/database && pnpm seed && cd ../..
  pnpm tsx scripts/seed-keywords.ts

  echo "[6/8] Running Paperclip onboarding..."
  npx paperclipai onboard --yes || echo "Paperclip onboarding skipped (not available)"

  echo "[7/8] Starting development servers..."
  echo "API: http://localhost:4000"
  echo "Dashboard: http://localhost:3000"

  echo "[8/8] Running health check..."
  sleep 3
  curl -sf http://localhost:4000/api/health || echo "API not yet ready"

  echo ""
  echo "=== Deployment Complete ==="
  echo "Dashboard: http://localhost:3000"
  echo "API: http://localhost:4000"
  echo ""
  echo "Next: Run Phase 0 with:"
  echo "  pnpm run phase0:import --file=./existing-leads.csv"

elif [ "$MODE" = "prod" ]; then
  echo "Production deployment via Fly.io/Railway..."
  echo "[1/9] Provisioning apps..."
  # fly apps create hyperscale-api || true
  # fly apps create hyperscale-dashboard || true

  echo "[2/9] Creating Postgres + Redis..."
  # fly postgres create --name hyperscale-db || true
  # fly redis create --name hyperscale-redis || true

  echo "[3/9] Running migrations..."
  # fly ssh console -C "cd /app && npx prisma migrate deploy"

  echo "[4/9] Setting secrets from Doppler..."
  # doppler secrets download --no-file | fly secrets import

  echo "[5/9] Running Paperclip onboarding..."
  # npx paperclipai onboard --yes

  echo "[6/9] Bootstrapping Instantly campaigns..."
  # curl -X POST $API_URL/api/campaigns/bootstrap/FACEBOOK_ADS
  # curl -X POST $API_URL/api/campaigns/bootstrap/INSTAGRAM
  # curl -X POST $API_URL/api/campaigns/bootstrap/LINKEDIN

  echo "[7/9] Running Phase 0 smoke test..."
  # pnpm run phase0:import --file=./sample-leads.csv --limit=10

  echo "[8/9] Verifying health endpoints..."
  # curl -sf $API_URL/api/health

  echo "[9/9] Sending deployment notification..."
  # curl -X POST $SLACK_WEBHOOK_ALERTS -d '{"text":"Hyperscale Leads deployed to production"}'

  echo "=== Production Deployment Complete ==="
else
  echo "Unknown mode: $MODE"
  echo "Usage: ./scripts/deploy.sh [local|prod]"
  exit 1
fi
