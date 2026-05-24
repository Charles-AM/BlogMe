# AI Newsletter System

Production-grade, free-tier newsletter aggregator for a portfolio project. It follows an n8n-style workflow:

`Fetch -> Filter -> Rate -> Summarize -> Send`

The system pulls live content from NewsAPI, Reddit public JSON, RSS feeds, and an optional Welt-compatible endpoint; dedupes articles against sent history; scores each article; summarizes with Gemini free tier; persists user preferences in SQLite; renders responsive HTML email; and sends through the Gmail API.

## Architecture

```text
GitHub Actions cron, 8 AM daily
        |
        v
Parallel fetchers: NewsAPI, Reddit, RSS, Welt
        |
        v
Deduplicate by normalized URL against sent_articles
        |
        v
Score = upvotes component + recency decay + keyword match + source baseline
        |
        v
Keep score >= 7/10, summarize with Gemini, cache results
        |
        v
Apply each user's categories and keywords
        |
        v
Render responsive HTML and send with Gmail API
```

## Features Recruiters Notice

- Deduplication across issues with `sent_articles`.
- Relevance scoring on a 10-point scale.
- User preference persistence in SQLite.
- Graceful NewsAPI fallback to RSS.
- Scheduled execution via GitHub Actions cron.
- Responsive HTML email template.
- Unsubscribe link with durable token.
- API usage logging to prove the project stays inside free tiers.
- Dry-run mode when Gmail or Gemini credentials are not configured.

## Quick Start

```bash
cd ai-newsletter-system
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python scripts/init_db.py
uvicorn app.main:app --reload
```

Open `http://localhost:8000`, save a test preference, then run:

```bash
python scripts/run_daily.py
```

That command performs a dry run by default. Add `--send` only after Gmail API auth is configured.

## Environment Variables

Required for the full experience:

- `GEMINI_API_KEY`: Gemini free-tier API key.
- `GMAIL_SENDER`: Gmail account used to send.
- `NEWSAPI_KEY`: NewsAPI free-tier key.

Optional but supported:

- `WELT_API_BASE_URL`, `WELT_API_KEY`: Welt-compatible news endpoint.
- `REDDIT_USER_AGENT`: identify the app for Reddit requests.
- `APP_BASE_URL`: used for unsubscribe links.

The app still runs without API keys using RSS-only fetching and fallback summaries.

## Gmail API Setup

1. Create a Google Cloud OAuth client for a desktop app.
2. Download the OAuth client JSON to `credentials.json`.
3. Run:

```bash
python scripts/gmail_auth.py
```

This writes `token.json`. For GitHub Actions, base64-encode the token and save it as `GMAIL_TOKEN_JSON_B64`:

```bash
base64 -i token.json
```

## API Routes

- `GET /`: user preference UI.
- `POST /preferences`: save preferences from the UI.
- `POST /api/preferences`: save preferences as JSON.
- `POST /api/fetch`: fetch, dedupe, score, and cache articles.
- `POST /api/filter/{user_id}`: preview filtered articles for a user.
- `POST /api/summarize`: fetch and summarize top articles.
- `POST /api/send?dry_run=true`: build issues; set `dry_run=false` to send.
- `GET /api/preview/{user_id}`: render the email HTML for a user.
- `GET /api/usage`: API usage totals for today.
- `GET /unsubscribe/{token}`: unsubscribe endpoint.

## SQL Schema

The complete schema is in `schema.sql`:

- `users`: email, category filters, keyword filters, unsubscribe token.
- `article_cache`: fetched and summarized article buffer.
- `newsletter_issues`: generated email HTML per user.
- `sent_articles`: per-user dedupe table.
- `api_usage`: provider usage and rate-limit audit trail.

## GitHub Actions Deployment

The included workflow lives at `.github/workflows/daily-newsletter.yml`.

Add these repository secrets:

- `APP_BASE_URL`
- `NEWSAPI_KEY`
- `GEMINI_API_KEY`
- `GMAIL_SENDER`
- `GMAIL_TOKEN_JSON_B64`
- `REDDIT_USER_AGENT`
- Optional: `WELT_API_BASE_URL`, `WELT_API_KEY`

The workflow runs daily at `12:00 UTC`, which is 8 AM New York time during daylight saving time. Use the manual `workflow_dispatch` input `send=true` to send real emails.

## Free-Tier Cost Breakdown

| Service | Use | Free-tier guard |
| --- | --- | --- |
| NewsAPI | General news | `NEWSAPI_DAILY_LIMIT=100`; app skips when reached |
| Reddit | Trending discussions | Public JSON endpoints, logged per subreddit |
| RSS | Fallback and baseline feeds | Free public feeds |
| Welt | Optional politics/sports/economy source | Optional endpoint; failures fall back silently |
| Gemini | AI summaries | Batched top articles only, logged per summary |
| Gmail API | Email delivery | Free with Google account |
| SQLite | Preferences/cache/dedupe | Local file, no hosted DB cost |
| GitHub Actions | Daily scheduler | Free for public repos within included minutes |

Target monthly cost: `$0`.

## Production Notes

- For a public demo, deploy the FastAPI app on Render or Railway free tier and keep GitHub Actions for the daily job.
- Keep `newsletter.db` persistent on the host so sent-article dedupe survives restarts.
- Review Gmail sending limits before sending to a large list.
- Add a privacy policy before collecting real subscriber emails.
