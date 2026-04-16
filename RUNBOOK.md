# Operational Runbook

This runbook covers how to respond to alerts, handle common incidents, and perform routine maintenance for Hyperscale Leads.

---

## Slack Alert Channels

| Channel | Webhook Variable | What It Receives |
|---------|------------------|------------------|
| `#hl-alerts` | `SLACK_WEBHOOK_ALERTS` | System alerts (source failures, budget warnings, pipeline errors) |
| `#hl-replies` | `SLACK_WEBHOOK_REPLIES` | Hot leads — positive reply detected, needs human response |
| `#hl-daily` | `SLACK_WEBHOOK_DAILY` | Paperclip's daily digest (metrics, wins, concerns) |
| `#hl-strategy` | `SLACK_WEBHOOK_STRATEGY` | Paperclip's weekly strategy report |
| `#hl-escalations` | `SLACK_WEBHOOK_ESCALATIONS` | Items Paperclip cannot handle autonomously |

### Alert Severity Guide

| Severity | Response Time | Examples |
|----------|---------------|----------|
| **Critical** | Immediate (< 15 min) | All sources returning 0 leads, database down, budget hard cap hit |
| **Warning** | Within 1 hour | Single source degraded, budget at 80%, session challenged |
| **Info** | Next check-in | Paperclip paused a keyword, tier switch pending confirmation |

---

## Common Scenarios

### 1. Source Adapter Returning 0 Leads

**Symptoms**: Health view shows a red source indicator. `#hl-alerts` fires with "0 leads from [source]".

**Steps**:
1. Go to `/sources` in the dashboard — check which tier is active and its health metrics
2. Check if the source's API key is still valid:
   - Facebook: Verify `FB_AD_LIBRARY_TOKEN` hasn't expired
   - LinkedIn: Check PhantomBuster agent status in their dashboard
   - Instagram: Verify `APIFY_TOKEN` and actor status
3. Check tier health JSON in the SourceConfig record (Prisma Studio or `/api/sources`)
4. If Tier 1 is failing, the system should have auto-switched to Tier 2. Check if `autoTierSwitch` is enabled
5. If all tiers are failing, check proxy health (BrightData dashboard)
6. Try triggering a manual scrape job from the dashboard or API:
   ```bash
   curl -X POST http://localhost:4000/api/sources/FACEBOOK_ADS/scrape
   ```
7. If the issue persists, check the scraper app logs:
   ```bash
   docker logs hyperscale-scraper --tail 100
   ```

### 2. Budget Alert Triggered

**Symptoms**: `#hl-alerts` fires with "Budget at 80%" or "Budget hard cap reached".

**Steps**:
1. Go to `/budgets` in the dashboard — see which provider hit the threshold
2. Review spending rate: is this expected growth or a runaway cost?
3. If expected, approve a budget increase via the dashboard or API:
   ```bash
   curl -X PATCH http://localhost:4000/api/budgets/<id> \
     -H "Content-Type: application/json" \
     -d '{"monthlyCapUsd": 750}'
   ```
4. If `hardStopAt100` is true and the cap was hit, the provider is paused. The system will auto-switch to a cheaper alternative if `autoSwitchTo` is configured
5. Check if Paperclip has a recommendation pending at `/paperclip` — it may suggest budget reallocation
6. Wait for monthly reset (`monthResetAt` field) or manually reset:
   ```bash
   curl -X POST http://localhost:4000/api/budgets/<id>/reset
   ```

### 3. Session Challenged

**Symptoms**: Scraper logs show "session challenge" or "captcha detected". Remediation created with trigger `session_challenge`.

**Steps**:
1. Go to `/sessions` in the dashboard — check which account is affected
2. If auto-reauth is configured and TOTP is available, the system will attempt reauth automatically
3. Check the remediation status at `/api/leads?status=AUTO_REMEDIATING`
4. If auto-reauth failed (status shows `FAILED` or `ESCALATED`):
   - Log into the affected account manually in a browser
   - Complete any verification (SMS, email, CAPTCHA)
   - Export fresh cookies and update the session:
     ```bash
     curl -X PATCH http://localhost:4000/api/sessions/<id>/cookies \
       -H "Content-Type: application/json" \
       -d '{"cookies": "<base64-encoded-cookies>"}'
     ```
5. Run a health check on the session:
   ```bash
   curl -X POST http://localhost:4000/api/sessions/<id>/health-check
   ```

### 4. Pipeline Stalled

**Symptoms**: Leads stuck in non-terminal states for extended periods. Health view shows low upload numbers.

**Steps**:
1. Check queue stats via the BullMQ dashboard or API:
   ```bash
   curl http://localhost:4000/api/health/overview
   ```
2. Look for stuck jobs (jobs in `active` state for > 5 minutes):
   ```bash
   # Connect to Redis and inspect queues
   redis-cli
   > LLEN bull:enrich:active
   > LLEN bull:validate:active
   ```
3. Check for a backed-up queue — if `enrich` has 1000+ waiting jobs, the enrichment providers may be rate-limited
4. Restart workers if needed:
   ```bash
   # Restart the API (which includes all BullMQ workers)
   pnpm --filter @hyperscale/api run dev
   ```
5. Check for dead-letter items (leads in `ERROR` status). Paperclip reviews these every 15 minutes, but you can force a review:
   ```bash
   curl -X POST http://localhost:4000/api/paperclip/run-cycle?cycle=15min
   ```

### 5. Deliverability Dropping

**Symptoms**: Email open rates declining. Validation pass rate dropping. `#hl-alerts` warning about deliverability.

**Steps**:
1. Go to `/sources` — check validation stats for recent leads
2. Check if a specific source is producing lower-quality emails:
   ```sql
   SELECT source, COUNT(*),
     SUM(CASE WHEN "neverbounceResult" = 'VALID' THEN 1 ELSE 0 END) as valid
   FROM "Lead"
   WHERE "validatedAt" > NOW() - INTERVAL '24 hours'
   GROUP BY source;
   ```
3. If a source's validation rate drops below 60%, consider pausing it temporarily
4. Check Instantly campaign health:
   ```bash
   curl http://localhost:4000/api/campaigns
   ```
5. Review if the ICP criteria need tightening — Paperclip may already have a recommendation
6. If urgent, pause all campaigns:
   ```bash
   curl -X POST http://localhost:4000/api/campaigns/pause-all
   ```

### 6. Paperclip Escalation

**Symptoms**: Message in `#hl-escalations` with Paperclip's recommendation.

**Steps**:
1. Read Paperclip's recommendation — it always includes reasoning and context
2. Go to `/paperclip` in the dashboard to see the full action log
3. Possible escalation types:
   - **Budget increase request**: Paperclip recommends increasing a provider budget. Approve or reject in the dashboard.
   - **ICP criteria change**: Paperclip wants to adjust targeting. Review the data it cites, then approve/reject.
   - **Provider disable**: Paperclip recommends permanently disabling a provider. This requires human approval.
4. To approve: click "Approve" on the action in `/paperclip`, or:
   ```bash
   curl -X PATCH http://localhost:4000/api/paperclip/<action-id> \
     -H "Content-Type: application/json" \
     -d '{"humanFeedback": "approved"}'
   ```
5. To reject: same endpoint with `"humanFeedback": "rejected"` — Paperclip will log this and adjust future behavior.

---

## Provisioning New Accounts

### LinkedIn Account

1. Create or obtain a LinkedIn account with Sales Navigator access
2. Log in from a clean browser with a residential proxy
3. Export cookies (use a browser extension)
4. Add the session via the dashboard `/sessions` page or API:
   ```bash
   curl -X POST http://localhost:4000/api/sessions \
     -H "Content-Type: application/json" \
     -d '{
       "service": "linkedin",
       "account": "newaccount@email.com",
       "cookies": "<base64-cookies>",
       "username": "<encrypted>",
       "password": "<encrypted>"
     }'
   ```
5. If the account has 2FA, also add the TOTP secret for auto-reauth
6. Run a health check to verify: `POST /api/sessions/<id>/health-check`

### Instagram Account

1. Create or obtain an Instagram business account
2. Same process as LinkedIn — export cookies, add via API
3. Instagram sessions tend to expire faster — ensure TOTP is configured for auto-reauth

---

## Key Rotation

### Rotating API Keys

1. Generate a new key from the provider's dashboard
2. Update in Doppler (production) or `.env` (local)
3. Restart the affected service:
   ```bash
   # Restart API to pick up new env vars
   pnpm --filter @hyperscale/api run dev
   ```
4. Verify by checking the health endpoint: `GET /api/health`
5. Revoke the old key from the provider's dashboard

### Rotating Session Encryption Key

1. This is a destructive operation — all stored session credentials will become unreadable
2. Generate a new 256-bit key: `openssl rand -base64 32`
3. Re-encrypt all session credentials (or re-import them) after updating `SESSION_ENCRYPTION_KEY`

---

## Manual Keyword Management

### Adding a Keyword

```bash
curl -X POST http://localhost:4000/api/keywords \
  -H "Content-Type: application/json" \
  -d '{
    "primary": "facebook ads agency",
    "secondary": "lead generation",
    "source": "FACEBOOK_ADS",
    "discoveredBy": "manual"
  }'
```

Or use the `/keywords` page in the dashboard.

### Disabling a Keyword

```bash
curl -X PATCH http://localhost:4000/api/keywords/<id> \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

Paperclip may also disable keywords autonomously based on performance data.

---

## Running Phase 0 Again

If you need to re-validate the pipeline (e.g., after infrastructure changes):

```bash
# Full run with existing leads
pnpm run phase0:import --file=./existing-leads.csv

# Quick smoke test with sample data and limit
pnpm run phase0:import --file=./scripts/sample-leads.csv --limit=10

# Dry run (import to DB only, no pipeline processing)
pnpm run phase0:import --file=./existing-leads.csv --dry-run
```

The Phase 0 script has a $100 hard cap safety check to prevent runaway costs on first runs.

---

## Emergency Procedures

### Pause All Campaigns

Immediately stops all outreach. No new emails will be sent.

```bash
curl -X POST http://localhost:4000/api/campaigns/pause-all
```

Or from the dashboard Health page, click "Pause All".

### Drain All Queues

Stops all pipeline processing. Leads in-flight will remain in their current state.

```bash
# Connect to Redis and flush all BullMQ queues
redis-cli
> KEYS bull:*:waiting
> DEL bull:enrich:waiting bull:score:waiting bull:validate:waiting bull:personalize:waiting bull:upload:waiting
```

**Warning**: This is destructive. Queued jobs will be lost. Leads already in the pipeline will resume from their current status when workers restart.

### Full System Shutdown

```bash
# Stop all Node processes
pkill -f "node.*hyperscale"

# Stop Docker services
docker compose down

# Verify nothing is running
docker ps
lsof -i :3000,:4000
```

### Recovery After Emergency

1. Start infrastructure: `docker compose up -d`
2. Wait for health checks to pass: `curl http://localhost:4000/api/health`
3. Check for leads stuck in non-terminal states and re-queue if needed
4. Resume campaigns one at a time from `/campaigns`
5. Post in `#hl-alerts` that the system is back online
