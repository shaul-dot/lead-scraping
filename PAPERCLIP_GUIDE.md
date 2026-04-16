# Paperclip CMO Guide

## What is Paperclip?

Paperclip is the AI operator (powered by Anthropic Claude) that autonomously manages the day-to-day operations of Hyperscale Leads. It runs on four scheduled cycles — every 15 minutes, hourly, daily, and weekly — monitoring system health, triaging alerts, optimizing keywords, managing budgets, and escalating only when a human decision is genuinely required.

Paperclip is implemented in the `@hyperscale/paperclip` package and its actions are exposed through the `/paperclip` route in both the API and dashboard.

---

## Authority Matrix

Paperclip has a strict authority matrix that governs what it can do on its own versus what requires human approval.

| Action | Authority Level | Details |
|--------|----------------|---------|
| Retry failed job | **Autonomous** | Retries leads in ERROR state after reviewing remediation history |
| Requeue DLQ items | **Autonomous** | Processes dead-letter queue items (retry, discard, or escalate) |
| Enable/disable keyword | **Autonomous** | Disables underperforming keywords, enables promising ones |
| Add new keyword | **Autonomous** | Discovers and adds new keywords based on booking patterns |
| Acknowledge non-critical alert | **Autonomous** | Auto-resolves info/warning alerts it can handle |
| Switch source tier | **Autonomous + 24h confirmation** | Switches tiers immediately but reverts automatically if no human confirms within 24 hours |
| Increase provider budget | **Recommend only** | Posts recommendation to `#hl-escalations`, waits for human approval |
| Pause campaign | **Autonomous (pause only)** | Can pause a campaign but **cannot resume** — human must re-enable |
| Reauthenticate session | **Autonomous** | Triggers auto-reauth when a session challenge is detected |
| Respond to positive reply | **Never** | Can only draft responses — a human must send all outbound replies |
| Modify personalization prompts | **Autonomous A/B test** | Can create and run A/B tests on email copy, promote winning variants |
| Change ICP criteria | **Recommend only** | Proposes ICP changes with data, requires human approval |
| Disable provider permanently | **Recommend only** | Recommends disabling a provider, requires human approval |

---

## What Paperclip CAN Do Autonomously

- Triage and acknowledge non-critical alerts
- Retry failed leads and process the dead-letter queue
- Enable, disable, and add keywords based on performance data
- Switch source tiers (with 24h auto-revert if unconfirmed)
- Trigger session re-authentication
- Pause campaigns (but not resume them)
- Run A/B tests on personalization prompts and promote winners
- Generate daily digests and weekly strategy reports
- Flag hot leads in Slack for human follow-up

## What Paperclip Can ONLY Recommend

- Budget increases for any provider
- Changes to ICP scoring criteria
- Permanently disabling a provider
- Any action that increases recurring costs

These appear as recommendations in the `/paperclip` dashboard page and in `#hl-escalations` on Slack.

## What Paperclip NEVER Does

- Send emails or reply to leads (it can draft, but never send)
- Delete data from the database
- Modify encryption keys or security settings
- Access external systems outside its defined integrations
- Resume a paused campaign
- Override a human's explicit rejection

---

## Overriding a Paperclip Action

If Paperclip takes an autonomous action you disagree with:

1. Go to `/paperclip` in the dashboard
2. Find the action in the activity log
3. Click **Override** to reverse the action
4. Provide feedback (this helps Paperclip learn your preferences)

Via the API:

```bash
curl -X PATCH http://localhost:4000/api/paperclip/<action-id> \
  -H "Content-Type: application/json" \
  -d '{"humanFeedback": "rejected: <your reason>"}'
```

For tier switches specifically: if you don't confirm within 24 hours, the switch auto-reverts. You can also manually revert earlier via `/sources`.

---

## Approving / Rejecting Recommendations

When Paperclip makes a recommendation (budget increase, ICP change, etc.):

1. You'll see it in `#hl-escalations` on Slack and on `/paperclip` in the dashboard
2. Click **Approve** or **Reject** in the dashboard
3. If approving, the action executes immediately
4. If rejecting, provide a reason — Paperclip factors this into future decisions

Via the API:

```bash
# Approve
curl -X PATCH http://localhost:4000/api/paperclip/<action-id> \
  -H "Content-Type: application/json" \
  -d '{"humanFeedback": "approved"}'

# Reject
curl -X PATCH http://localhost:4000/api/paperclip/<action-id> \
  -H "Content-Type: application/json" \
  -d '{"humanFeedback": "rejected: too aggressive on budget"}'
```

---

## How Actions Are Logged

Every Paperclip action is stored in the `PaperclipAction` table:

| Field | Description |
|-------|-------------|
| `id` | Unique action ID |
| `category` | One of: `keyword_optimization`, `alert_triage`, `dlq_processing`, `tier_switch_review`, `reply_analysis`, `daily_digest`, `weekly_strategy`, `session_reauth`, `campaign_health`, `budget_review`, `personalization_ab_test` |
| `action` | Human-readable description of what was done |
| `reasoning` | Paperclip's chain-of-thought explaining why |
| `inputContext` | JSON snapshot of the data Paperclip analyzed |
| `outputResult` | JSON result of the action taken |
| `humanFeedback` | Your approval, rejection, or override (null if no human review yet) |
| `performedAt` | Timestamp |

View all actions at `/paperclip` in the dashboard or via:

```bash
curl http://localhost:4000/api/paperclip?limit=50
```

---

## Running Cadence

| Cycle | Frequency | What It Does |
|-------|-----------|--------------|
| **15-minute** | Every 15 min | Scans unacknowledged alerts, reviews DLQ leads, processes pending remediations. Takes autonomous actions for retries, discards, and session reauths. |
| **Hourly** | Every hour | Checks source health metrics, reviews budget pacing, flags hot leads from positive replies, checks for expired tier switch confirmations. |
| **Daily** | Once per day | Aggregates daily metrics (scraped, enriched, uploaded, booked, costs). Generates a digest with top wins, concerns, and escalations. Posts to `#hl-daily`. |
| **Weekly** | Once per week | Deep strategy review: analyzes keyword performance, booked lead patterns, budget utilization, reply breakdown. Generates keyword add/remove recommendations. Autonomously disables underperforming keywords. Posts to `#hl-strategy`. |

---

## Reading the Daily Digest

The daily digest is posted to `#hl-daily` on Slack and logged as a `daily_digest` action. It contains:

- **Metrics**: Leads scraped, enriched, ICP passed, validated, uploaded, replied, booked, total cost, cost per lead
- **By source**: Breakdown for Facebook, Instagram, LinkedIn
- **Top wins**: The best things that happened today
- **Top concerns**: Issues that need attention
- **Autonomous actions**: Summary of what Paperclip did on its own
- **Recommendations**: Suggestions that need your input
- **Escalations**: Items that require human decision

To view historical digests:

```bash
curl "http://localhost:4000/api/paperclip?category=daily_digest&limit=7"
```

---

## Reading the Weekly Strategy Report

The weekly strategy report is posted to `#hl-strategy` and logged as a `weekly_strategy` action. It contains:

- **Booked lead patterns**: Industry, geography, lead magnet type, and keyword patterns of leads that actually booked meetings
- **Keyword recommendations**: Which keywords to add (with reasoning) and which to remove
- **Personalization insights**: What email copy and angles are working best
- **Budget recommendations**: Where to increase/decrease spend based on ROI

Paperclip autonomously disables keywords in the "remove" list. Keywords in the "add" list are created automatically if the `add_new_keyword` authority is enabled.

---

## Diagnosing Paperclip Issues

### Is Paperclip Active?

On the Health page, the "Paperclip" traffic light should always be green with "Autonomous agent active". If it's not:

1. Check the most recent `PaperclipAction` timestamp:
   ```bash
   curl "http://localhost:4000/api/paperclip?limit=1"
   ```
   If the last action was more than 30 minutes ago, Paperclip may be stuck.

2. Check the orchestrator cron jobs are running:
   ```bash
   # Look for cron registration in API logs
   docker logs hyperscale-api --tail 50 | grep "cron\|schedule\|orchestrator"
   ```

3. Verify the `ANTHROPIC_API_KEY` is set and valid — Paperclip uses Claude for all its reasoning.

### Paperclip Not Taking Actions

1. **Check API key**: `ANTHROPIC_API_KEY` must be set. Paperclip calls Anthropic's API for every decision.
2. **Check logs**: Look for errors in the `paperclip-cycles` logger:
   ```bash
   docker logs hyperscale-api --tail 200 | grep "paperclip"
   ```
3. **Check budget**: If the Anthropic budget is exhausted (`hardStopAt100` = true), Paperclip cannot make LLM calls. Check `/budgets`.
4. **Check queue workers**: The `paperclip:15min`, `paperclip:hourly`, `paperclip:daily`, and `paperclip:weekly` queues need active consumers.
5. **Manual cycle trigger**: Force a cycle to test:
   ```bash
   curl -X POST http://localhost:4000/api/paperclip/run-cycle?cycle=15min
   ```

### Paperclip Making Bad Decisions

1. Check the `reasoning` field on recent actions — does the reasoning make sense given the data?
2. Provide feedback via the dashboard or API (`humanFeedback` field)
3. Check if the data Paperclip sees (`inputContext`) is accurate
4. If systematic, review the prompts in `packages/paperclip/src/prompts.ts`
