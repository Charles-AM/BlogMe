import json
from dataclasses import asdict
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel, EmailStr

from app import database
from app.config import get_settings
from app.models import CATEGORIES
from app.services.ai import summarize_articles
from app.services.emailer import render_email
from app.services.fetchers import fetch_all
from app.services.pipeline import build_and_send_daily, run_fetch
from app.services.scoring import apply_scores, dedupe_articles, filter_for_user


BASE_DIR = Path(__file__).resolve().parent
templates = Environment(
    loader=FileSystemLoader(BASE_DIR / "templates"),
    autoescape=select_autoescape(["html"]),
)

app = FastAPI(
    title="AI Newsletter System",
    description="Free-tier AI-powered newsletter aggregator with dedupe, scoring, preference persistence, and Gmail delivery.",
    version="1.0.0",
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


class PreferencePayload(BaseModel):
    email: EmailStr
    categories: list[str]
    keywords: list[str] = []


@app.on_event("startup")
def startup() -> None:
    database.init_db()


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    html = templates.get_template("index.html").render(categories=CATEGORIES, saved=False)
    return HTMLResponse(html)


@app.post("/preferences", response_class=HTMLResponse)
def save_preferences(
    email: EmailStr = Form(...),
    categories: list[str] = Form(default=[]),
    keywords: str = Form(default=""),
):
    normalized_categories = [item for item in categories if item in CATEGORIES]
    normalized_keywords = [item.strip() for item in keywords.split(",") if item.strip()]
    database.create_user(str(email), normalized_categories, normalized_keywords)
    html = templates.get_template("index.html").render(categories=CATEGORIES, saved=True, email=email)
    return HTMLResponse(html)


@app.post("/api/preferences")
def save_preferences_api(payload: PreferencePayload):
    categories = [item for item in payload.categories if item in CATEGORIES]
    return database.create_user(str(payload.email), categories, payload.keywords)


@app.get("/unsubscribe/{token}", response_class=HTMLResponse)
def unsubscribe(token: str):
    if not database.unsubscribe_user(token):
        raise HTTPException(status_code=404, detail="Unsubscribe token not found")
    return HTMLResponse("<h1>You are unsubscribed</h1><p>You will not receive future issues.</p>")


@app.post("/api/fetch")
async def fetch_route():
    return await run_fetch(get_settings())


@app.post("/api/filter/{user_id}")
async def filter_route(user_id: int):
    settings = get_settings()
    user = database.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    articles = await fetch_all(settings)
    scored = apply_scores(dedupe_articles(articles, database.sent_urls()))
    filtered = filter_for_user(
        scored,
        json.loads(user["categories"]),
        json.loads(user["keywords"]),
        settings.min_score,
    )[: settings.max_articles_per_user]
    return {"count": len(filtered), "articles": [asdict(article) for article in filtered]}


@app.post("/api/summarize")
async def summarize_route():
    settings = get_settings()
    articles = apply_scores(dedupe_articles(await fetch_all(settings), database.sent_urls()))
    eligible = [article for article in articles if article.score >= settings.min_score][:10]
    summarized = await summarize_articles(eligible, settings)
    return {"count": len(summarized), "articles": [asdict(article) for article in summarized]}


@app.post("/api/send")
async def send_route(dry_run: bool = True):
    return await build_and_send_daily(get_settings(), dry_run=dry_run)


@app.get("/api/preview/{user_id}", response_class=HTMLResponse)
async def preview_email(user_id: int):
    settings = get_settings()
    user = database.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    articles = apply_scores(dedupe_articles(await fetch_all(settings), database.sent_urls()))
    eligible = await summarize_articles([article for article in articles if article.score >= settings.min_score][:8], settings)
    filtered = filter_for_user(
        eligible,
        json.loads(user["categories"]),
        json.loads(user["keywords"]),
        settings.min_score,
    )[: settings.max_articles_per_user]
    html = render_email(
        recipient=user["email"],
        unsubscribe_url=f"{settings.app_base_url}/unsubscribe/{user['unsubscribe_token']}",
        articles=filtered,
    )
    return HTMLResponse(html)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/usage")
def usage():
    with database.connect() as conn:
        rows = conn.execute(
            """
            SELECT provider, endpoint, status, SUM(units) AS units, COUNT(*) AS calls
            FROM api_usage
            WHERE date(created_at) = date('now')
            GROUP BY provider, endpoint, status
            ORDER BY provider, endpoint
            """
        ).fetchall()
    return {"today": [dict(row) for row in rows]}
