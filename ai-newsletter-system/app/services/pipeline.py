import json
from datetime import datetime

from app import database
from app.config import Settings
from app.models import CATEGORIES
from app.services.ai import summarize_articles
from app.services.emailer import render_email, send_gmail
from app.services.fetchers import fetch_all
from app.services.scoring import apply_scores, dedupe_articles, filter_for_user


async def run_fetch(settings: Settings) -> dict:
    articles = await fetch_all(settings, CATEGORIES)
    unique = dedupe_articles(articles, database.sent_urls())
    scored = apply_scores(unique)
    database.cache_articles(scored)
    return {"fetched": len(articles), "deduped": len(unique), "cached": len(scored)}


async def build_and_send_daily(settings: Settings, dry_run: bool = False) -> dict:
    raw_articles = await fetch_all(settings, CATEGORIES)
    unique_articles = dedupe_articles(raw_articles, database.sent_urls())
    scored_articles = apply_scores(unique_articles)
    eligible_articles = [article for article in scored_articles if article.score >= settings.min_score]
    summarized = await summarize_articles(eligible_articles[:40], settings)
    database.cache_articles(summarized)

    sent = 0
    issues = []
    for user in database.list_active_users():
        categories = json.loads(user["categories"])
        keywords = json.loads(user["keywords"])
        user_articles = filter_for_user(summarized, categories, keywords, settings.min_score)
        user_articles = user_articles[: settings.max_articles_per_user]
        if not user_articles:
            continue
        subject = f"Your AI-curated briefing for {datetime.utcnow().strftime('%b %-d')}"
        unsubscribe_url = f"{settings.app_base_url}/unsubscribe/{user['unsubscribe_token']}"
        html = render_email(recipient=user["email"], unsubscribe_url=unsubscribe_url, articles=user_articles)
        status = "dry_run" if dry_run else "queued"
        issue_id = database.create_issue(user["id"], subject, html, status)
        if not dry_run:
            status = send_gmail(settings, user["email"], subject, html)
            database.update_issue_status(issue_id, status)
            database.mark_sent(user["id"], issue_id, user_articles)
        sent += 1
        issues.append({"user_id": user["id"], "articles": len(user_articles), "status": status})

    return {
        "fetched": len(raw_articles),
        "eligible": len(eligible_articles),
        "issues_created": sent,
        "dry_run": dry_run,
        "issues": issues,
    }
