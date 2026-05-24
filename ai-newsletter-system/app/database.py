import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable

from app.config import get_settings
from app.models import Article


SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema.sql"


def _db_path() -> str:
    database_url = get_settings().database_url
    if database_url.startswith("sqlite:///"):
        return database_url.replace("sqlite:///", "", 1)
    return database_url


@contextmanager
def connect():
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA_PATH.read_text())


def create_user(email: str, categories: list[str], keywords: list[str]) -> dict:
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO users(email, categories, keywords, is_active)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(email) DO UPDATE SET
                categories=excluded.categories,
                keywords=excluded.keywords,
                is_active=1,
                updated_at=CURRENT_TIMESTAMP
            RETURNING *
            """,
            (email, json.dumps(categories), json.dumps(keywords)),
        )
        return dict(cursor.fetchone())


def list_active_users() -> list[sqlite3.Row]:
    with connect() as conn:
        return list(conn.execute("SELECT * FROM users WHERE is_active = 1"))


def get_user(user_id: int) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def unsubscribe_user(token: str) -> bool:
    with connect() as conn:
        cursor = conn.execute(
            "UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE unsubscribe_token = ?",
            (token,),
        )
        return cursor.rowcount > 0


def cache_articles(articles: Iterable[Article]) -> int:
    count = 0
    with connect() as conn:
        for article in articles:
            conn.execute(
                """
                INSERT INTO article_cache
                    (url, normalized_url, title, source, category, description, author,
                     published_at, upvotes, score, summary, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(normalized_url) DO UPDATE SET
                    title=excluded.title,
                    score=MAX(article_cache.score, excluded.score),
                    summary=COALESCE(NULLIF(excluded.summary, ''), article_cache.summary),
                    updated_at=CURRENT_TIMESTAMP
                """,
                (
                    article.url,
                    article.normalized_url(),
                    article.title,
                    article.source,
                    article.category,
                    article.description,
                    article.author,
                    article.published_at.isoformat(),
                    article.upvotes,
                    article.score,
                    article.summary,
                    json.dumps(article.metadata),
                ),
            )
            count += 1
    return count


def sent_urls() -> set[str]:
    with connect() as conn:
        rows = conn.execute("SELECT normalized_url FROM sent_articles").fetchall()
        return {row["normalized_url"] for row in rows}


def mark_sent(user_id: int, issue_id: int, articles: Iterable[Article]) -> None:
    with connect() as conn:
        for article in articles:
            conn.execute(
                """
                INSERT OR IGNORE INTO sent_articles(user_id, issue_id, normalized_url, title, url)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user_id, issue_id, article.normalized_url(), article.title, article.url),
            )


def create_issue(user_id: int, subject: str, html: str, status: str) -> int:
    with connect() as conn:
        cursor = conn.execute(
            "INSERT INTO newsletter_issues(user_id, subject, html, status) VALUES (?, ?, ?, ?)",
            (user_id, subject, html, status),
        )
        return int(cursor.lastrowid)


def update_issue_status(issue_id: int, status: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE newsletter_issues SET status = ? WHERE id = ?", (status, issue_id))


def log_api_usage(provider: str, endpoint: str, units: int, status: str, detail: str = "") -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO api_usage(provider, endpoint, units, status, detail)
            VALUES (?, ?, ?, ?, ?)
            """,
            (provider, endpoint, units, status, detail[:500]),
        )


def provider_usage_today(provider: str) -> int:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT COALESCE(SUM(units), 0) AS total
            FROM api_usage
            WHERE provider = ? AND date(created_at) = date('now')
            """,
            (provider,),
        ).fetchone()
        return int(row["total"])
