# Dashboard Guide

The Hyperscale Leads dashboard runs on Next.js 15 at `http://localhost:3000` (local) or your production URL. It provides real-time visibility into the entire lead generation pipeline.

---

## Health View (Home Page `/`)

The home page is your operational overview. Scan it once a day (or whenever you get an alert) to understand system state at a glance.

### Traffic Lights

Four indicators at the top of the page:

| Light | Green | Yellow | Red |
|-------|-------|--------|-----|
| **Pipeline** | Uploaded count >= 80% of daily target | 50-80% of target | Below 50% of target |
| **Budget** | All providers below 80% of monthly cap | At least one at 80-99% | At least one at or above 100% |
| **Sources** | All sources healthy | — | One or more sources unhealthy |
| **Paperclip** | Autonomous agent active and recent action within 30 min | — | Paperclip inactive or erroring |

Click any traffic light to jump to the relevant detail page.

### Today's Numbers

Per-channel cards showing:
- Leads uploaded vs daily target (with progress bar)
- Cost and cost-per-lead
- Replies and meetings booked
- Percentage of target hit (badge)

### Paperclip's Latest Action

Shows the most recent autonomous action with reasoning. Click **Override** to reverse it.

### Active Alerts

Outstanding warnings and info alerts. Click **Fix Now** or **Review** to take action.

### Quick Actions

- **Import CSV**: Upload leads for Phase 0 or manual import
- **Run Pipeline**: Trigger a pipeline run
- **Pause All**: Emergency stop for all campaigns
- **Paperclip Queue**: View pending Paperclip actions

---

## Natural Language Query Bar

At the top of every page, the query bar lets you ask questions in plain English. It calls the `/api/query` endpoint, which uses an LLM to translate your question into a database query and return a human-readable answer.

### Example Queries

| Question | What it does |
|----------|--------------|
| "How many leads did we scrape from Instagram this week?" | Counts leads by source for the past 7 days |
| "What's our best keyword?" | Returns the keyword with highest booking yield |
| "Show me leads that replied but didn't book" | Filters leads with `replyClassification = POSITIVE` and `meetingBooked = false` |
| "What did Paperclip do today?" | Lists today's PaperclipAction records |
| "Which source has the lowest cost per lead?" | Calculates CPL by source from DailyStats |
| "How much have we spent on Apollo this month?" | Returns Apollo budget utilization |
| "List all escalated leads" | Finds leads with status `ESCALATED` |

Type your question, press Enter, and the answer appears below the bar. Click the X to dismiss.

---

## Command Palette (Cmd+K / Ctrl+K)

Press **Cmd+K** (Mac) or **Ctrl+K** (Windows/Linux) to open the command palette. It provides:

### Navigation

Jump to any page instantly:
- Health, Leads, Paperclip CMO, Sources, Campaigns, Keywords, Replies, Sessions, Budgets, Manual Review, Settings

### Actions

- **Run pipeline** — trigger a pipeline run
- **Generate daily report** — force Paperclip's daily digest
- **Pause campaigns** — emergency pause
- **Search leads** — jump to lead search

Use arrow keys to navigate, Enter to select, Esc to close.

---

## Page-by-Page Guide

### `/leads` — Lead Management

The central lead database. Every lead that enters the system appears here.

- **Search**: Filter by company name, email, status, source, or date range
- **Status filter**: Quick-filter tabs for each pipeline stage (RAW, ENRICHING, ENRICHED, etc.)
- **Bulk actions**: Select multiple leads to retry, discard, or escalate
- **Lead detail** (`/leads/[id]`): Click any lead to see its full journey — enrichment data, ICP score with reasoning, validation results, personalization copy, remediation history, and Exa context

### `/paperclip` — Paperclip CMO

Monitor and manage Paperclip's autonomous operations.

- **Activity log**: Chronological list of all Paperclip actions with category, reasoning, and outcome
- **Pending recommendations**: Actions that need your approval (budget increases, ICP changes)
- **Filter by category**: `keyword_optimization`, `alert_triage`, `dlq_processing`, `tier_switch_review`, `reply_analysis`, `budget_review`, etc.
- **Approve/Reject**: Click any recommendation to approve or reject with feedback
- **Override**: Reverse any autonomous action Paperclip took

### `/sources` — Source Health

Manage the three lead sources and their tier configurations.

- **Per-source cards**: Facebook Ads, Instagram, LinkedIn — each showing active tier, health metrics, error rate, leads per run
- **Tier switching**: View current tier, manually override, or configure auto-tier-switch rules
- **Tier health**: Detailed JSON view of each tier's performance metrics
- **Source config**: Edit tier configurations (API keys, agent IDs, proxy settings)

### `/campaigns` — Instantly Campaigns

Manage outreach campaigns connected to Instantly.

- **Campaign list**: All campaigns with status, daily send target, and health metrics
- **Pause/Resume**: Toggle individual campaigns on/off
- **Sequence templates**: View and edit email sequence templates
- **Bootstrap**: Create new campaigns per source

### `/keywords` — Keyword Management

Keywords drive scraping — each scrape job targets a specific keyword + source combination.

- **Keyword table**: All keywords with performance metrics (total yield, ICP pass rate, booking yield, score)
- **Enable/Disable**: Toggle keywords on/off
- **Add keyword**: Manually add new keywords
- **Paperclip suggestions**: See keywords Paperclip discovered or recommends adding/removing
- **Sort by score**: Paperclip's composite score combining yield, ICP pass rate, and booking rate

### `/replies` — Reply Management

Track and classify responses from leads.

- **Reply inbox**: All leads that have replied, grouped by classification
- **Classifications**: POSITIVE, NEUTRAL, NEGATIVE, OUT_OF_OFFICE, UNSUBSCRIBE, WRONG_PERSON, NOT_CLASSIFIED
- **Reclassify**: If the AI misclassified a reply, click to manually reclassify
- **Hot leads**: Positive replies are highlighted — these need a human response
- **Meeting booked toggle**: Mark when a meeting is booked from a reply

### `/sessions` — Session Management

Manage scraper sessions (browser cookies, credentials, 2FA).

- **Session list**: All accounts with status, service type, last used, last health check, failure count
- **Health check**: Trigger a manual health check for any session
- **Add account**: Add a new LinkedIn or Instagram account with cookies and credentials
- **Reauth**: Trigger manual re-authentication if auto-reauth failed
- **Status indicators**: Active, challenged, expired, disabled

### `/budgets` — Budget Monitoring

Track spending across all external providers.

- **Provider cards**: Each provider showing monthly cap, current usage, utilization percentage
- **Progress bars**: Visual budget burn-down per provider
- **Alerts**: Providers at 80%+ utilization are highlighted
- **Edit caps**: Adjust monthly budget caps
- **Auto-switch config**: Set which provider to fall back to when a budget is exhausted

### `/manual-review` — Escalated Items

Items that neither the pipeline nor Paperclip could resolve automatically.

- **Escalated leads**: Leads that hit max remediation attempts
- **Paperclip recommendations**: Actions waiting for human approval
- **Review queue**: Work through items one by one — approve, reject, or manually fix
- **Context**: Each item includes full history (what was tried, why it failed, Paperclip's recommendation)

### `/settings` — System Settings

- **Paperclip auto mode**: Toggle whether Paperclip acts autonomously or requires approval for everything
- **Notification preferences**: Configure which Slack channels receive which alerts
- **API key status**: View which keys are configured (without revealing values)

---

## Mobile Quick Reference

The dashboard is fully responsive with a mobile-optimized layout.

### Bottom Navigation

On mobile, the sidebar collapses into a bottom navigation bar with five tabs:

| Tab | Page | Icon |
|-----|------|------|
| Health | `/` | Activity |
| Leads | `/leads` | Users |
| Paperclip | `/paperclip` | Bot |
| Replies | `/replies` | MessageSquare |
| More | Expands menu | Menu |

### Mobile Gestures

- **Swipe left/right**: Navigate between adjacent pages
- **Pull to refresh**: On the Health page, pull down to refresh all metrics
- **Long press**: On lead cards, long press for quick actions (retry, escalate)

### Mobile Tips

- Traffic lights are condensed to a 2x2 grid on small screens
- Channel stat cards stack vertically
- The command palette is accessible via the search icon in the top bar
- The query bar is hidden by default on mobile — tap the search icon to expand

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` / `Ctrl+K` | Open command palette |
| `↑` `↓` | Navigate command palette / table rows |
| `Enter` | Select in command palette / open lead detail |
| `Esc` | Close command palette / close modal |
| `?` | Show keyboard shortcut help (when available) |
