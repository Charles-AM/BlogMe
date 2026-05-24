import asyncio

import google.generativeai as genai

from app import database
from app.config import Settings
from app.models import Article


SUMMARY_PROMPT = """
Summarize this newsletter article in 2 concise, factual bullets.
Mention why a busy reader should care. Avoid hype and do not invent facts.

Title: {title}
Source: {source}
Description: {description}
URL: {url}
"""


async def summarize_articles(articles: list[Article], settings: Settings) -> list[Article]:
    if not settings.gemini_api_key:
        for article in articles:
            article.summary = fallback_summary(article)
        database.log_api_usage("gemini", "summarize", 0, "skipped", "GEMINI_API_KEY missing")
        return articles

    genai.configure(api_key=settings.gemini_api_key)
    model = genai.GenerativeModel(settings.gemini_model)
    semaphore = asyncio.Semaphore(4)

    async def summarize_one(article: Article) -> Article:
        async with semaphore:
            prompt = SUMMARY_PROMPT.format(
                title=article.title,
                source=article.source,
                description=article.description[:1000],
                url=article.url,
            )
            try:
                response = await asyncio.to_thread(model.generate_content, prompt)
                article.summary = (response.text or "").strip() or fallback_summary(article)
                database.log_api_usage("gemini", "summarize", 1, "ok", settings.gemini_model)
            except Exception as exc:  # Gemini SDK exposes several provider-specific exceptions.
                article.summary = fallback_summary(article)
                database.log_api_usage("gemini", "summarize", 1, "fallback", str(exc))
            return article

    return await asyncio.gather(*(summarize_one(article) for article in articles))


def fallback_summary(article: Article) -> str:
    text = article.description.strip() or article.title
    return f"- {text[:220].strip()}\n- Source: {article.source}; score {article.score}/10."
