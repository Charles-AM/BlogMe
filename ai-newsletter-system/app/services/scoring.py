import math
from datetime import datetime, timezone

from app.models import Article


def keyword_hits(article: Article, keywords: list[str]) -> int:
    haystack = f"{article.title} {article.description}".lower()
    return sum(1 for keyword in keywords if keyword.lower().strip() in haystack)


def score_article(article: Article, global_keywords: list[str] | None = None) -> float:
    now = datetime.now(timezone.utc)
    age_hours = max((now - article.published_at).total_seconds() / 3600, 0)
    recency_decay = 4.0 * math.exp(-age_hours / 36)
    upvote_component = min(math.log10(max(article.upvotes, 0) + 1) * 2.0, 3.0)
    keyword_component = min(keyword_hits(article, global_keywords or []) * 1.5, 3.0)
    source_component = 1.0
    score = upvote_component + recency_decay + keyword_component + source_component
    return round(min(score, 10.0), 2)


def apply_scores(articles: list[Article], keywords: list[str] | None = None) -> list[Article]:
    for article in articles:
        article.score = score_article(article, keywords)
    return sorted(articles, key=lambda item: item.score, reverse=True)


def dedupe_articles(articles: list[Article], already_sent: set[str]) -> list[Article]:
    seen = set(already_sent)
    unique: list[Article] = []
    for article in articles:
        key = article.normalized_url()
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(article)
    return unique


def filter_for_user(articles: list[Article], categories: list[str], keywords: list[str], min_score: float) -> list[Article]:
    selected = []
    category_set = {category.lower() for category in categories}
    for article in articles:
        if category_set and article.category.lower() not in category_set:
            continue
        user_hits = keyword_hits(article, keywords)
        adjusted = min(10.0, article.score + (user_hits * 0.75))
        if adjusted >= min_score or user_hits:
            article.score = round(adjusted, 2)
            selected.append(article)
    return sorted(selected, key=lambda item: item.score, reverse=True)
