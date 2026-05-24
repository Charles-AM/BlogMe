import asyncio
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Iterable

import feedparser
import httpx

from app import database
from app.config import Settings
from app.models import Article, CATEGORIES


RSS_FEEDS = {
    "sports": [
        "https://www.espn.com/espn/rss/news",
        "https://feeds.bbci.co.uk/sport/rss.xml",
    ],
    "entertainment": [
        "https://variety.com/feed/",
        "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
    ],
    "education": [
        "https://www.edutopia.org/rss.xml",
        "https://www.insidehighered.com/rss.xml",
    ],
    "politics": [
        "https://feeds.npr.org/1014/rss.xml",
        "https://feeds.bbci.co.uk/news/politics/rss.xml",
    ],
    "technology": [
        "https://techcrunch.com/feed/",
        "https://www.theverge.com/rss/index.xml",
    ],
}


NEWSAPI_QUERIES = {
    "sports": "sports",
    "entertainment": "entertainment OR movies OR music",
    "education": "education OR universities OR schools",
    "politics": "politics OR election OR congress",
    "technology": "technology OR AI OR software",
}


SUBREDDITS = {
    "sports": ["sports", "nba", "soccer"],
    "entertainment": ["movies", "television", "music"],
    "education": ["education", "Teachers", "college"],
    "politics": ["politics", "PoliticalDiscussion"],
    "technology": ["technology", "Futurology", "programming"],
}


def _parse_datetime(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


async def fetch_all(settings: Settings, categories: Iterable[str] = CATEGORIES) -> list[Article]:
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
        tasks = []
        for category in categories:
            tasks.extend(
                [
                    fetch_newsapi(client, settings, category),
                    fetch_reddit(client, settings, category),
                    fetch_rss(client, category),
                    fetch_welt(client, settings, category),
                ]
            )
        results = await asyncio.gather(*tasks, return_exceptions=True)

    articles: list[Article] = []
    for result in results:
        if isinstance(result, Exception):
            database.log_api_usage("fetcher", "aggregate", 0, "error", str(result))
            continue
        articles.extend(result)
    return articles


async def fetch_newsapi(client: httpx.AsyncClient, settings: Settings, category: str) -> list[Article]:
    if not settings.newsapi_key:
        return []
    if database.provider_usage_today("newsapi") >= settings.newsapi_daily_limit:
        database.log_api_usage("newsapi", "everything", 0, "skipped", "daily free-tier cap reached")
        return []

    params = {
        "q": NEWSAPI_QUERIES[category],
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": 20,
        "apiKey": settings.newsapi_key,
    }
    try:
        response = await client.get("https://newsapi.org/v2/everything", params=params)
        database.log_api_usage("newsapi", "everything", 1, str(response.status_code), category)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        database.log_api_usage("newsapi", "everything", 1, "fallback_to_rss", str(exc))
        return await fetch_rss(client, category)

    payload = response.json()
    return [
        Article(
            title=item.get("title") or "Untitled",
            url=item.get("url") or "",
            source=(item.get("source") or {}).get("name") or "NewsAPI",
            category=category,
            description=item.get("description") or "",
            author=item.get("author"),
            published_at=_parse_datetime(item.get("publishedAt")),
            metadata={"provider": "newsapi"},
        )
        for item in payload.get("articles", [])
        if item.get("url") and item.get("title")
    ]


async def fetch_reddit(client: httpx.AsyncClient, settings: Settings, category: str) -> list[Article]:
    headers = {"User-Agent": settings.reddit_user_agent}
    articles: list[Article] = []
    for subreddit in SUBREDDITS[category]:
        url = f"https://www.reddit.com/r/{subreddit}/hot.json"
        try:
            response = await client.get(url, params={"limit": 10}, headers=headers)
            database.log_api_usage("reddit", f"/r/{subreddit}/hot", 1, str(response.status_code), category)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            database.log_api_usage("reddit", f"/r/{subreddit}/hot", 1, "error", str(exc))
            continue
        for child in response.json().get("data", {}).get("children", []):
            data = child.get("data", {})
            permalink = data.get("permalink")
            external_url = data.get("url") or ""
            if not permalink:
                continue
            articles.append(
                Article(
                    title=data.get("title") or "Reddit discussion",
                    url=external_url if external_url.startswith("http") else f"https://reddit.com{permalink}",
                    source=f"r/{subreddit}",
                    category=category,
                    description=data.get("selftext", "")[:500],
                    published_at=datetime.fromtimestamp(data.get("created_utc", 0), tz=timezone.utc),
                    upvotes=int(data.get("ups") or 0),
                    metadata={"provider": "reddit", "comments": data.get("num_comments", 0)},
                )
            )
    return articles


async def fetch_rss(client: httpx.AsyncClient, category: str) -> list[Article]:
    articles: list[Article] = []
    for feed_url in RSS_FEEDS[category]:
        try:
            response = await client.get(feed_url)
            database.log_api_usage("rss", feed_url, 1, str(response.status_code), category)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            database.log_api_usage("rss", feed_url, 1, "error", str(exc))
            continue
        parsed = feedparser.parse(response.text)
        for entry in parsed.entries[:15]:
            articles.append(
                Article(
                    title=entry.get("title", "Untitled"),
                    url=entry.get("link", ""),
                    source=parsed.feed.get("title", "RSS"),
                    category=category,
                    description=entry.get("summary", ""),
                    author=entry.get("author"),
                    published_at=_parse_datetime(entry.get("published") or entry.get("updated")),
                    metadata={"provider": "rss", "feed": feed_url},
                )
            )
    return [article for article in articles if article.url]


async def fetch_welt(client: httpx.AsyncClient, settings: Settings, category: str) -> list[Article]:
    if not settings.welt_api_base_url:
        return []
    headers = {"Accept": "application/json"}
    if settings.welt_api_key:
        headers["Authorization"] = f"Bearer {settings.welt_api_key}"
    try:
        response = await client.get(
            settings.welt_api_base_url.rstrip("/"),
            params={"category": category, "limit": 20},
            headers=headers,
        )
        database.log_api_usage("welt", "articles", 1, str(response.status_code), category)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        database.log_api_usage("welt", "articles", 1, "fallback_to_rss", str(exc))
        return []

    payload = response.json()
    items = payload.get("articles") if isinstance(payload, dict) else payload
    return [
        Article(
            title=item.get("title") or "Untitled",
            url=item.get("url") or item.get("link") or "",
            source=item.get("source") or "Welt",
            category=category,
            description=item.get("description") or item.get("summary") or "",
            author=item.get("author"),
            published_at=_parse_datetime(item.get("publishedAt") or item.get("date")),
            metadata={"provider": "welt"},
        )
        for item in (items or [])
        if item.get("url") or item.get("link")
    ]
