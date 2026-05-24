from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_base_url: str = "http://localhost:8000"
    database_url: str = "./newsletter.db"

    newsapi_key: str | None = None
    reddit_client_id: str | None = None
    reddit_client_secret: str | None = None
    reddit_user_agent: str = "ai-newsletter-system/1.0"
    welt_api_base_url: str | None = None
    welt_api_key: str | None = None

    gemini_api_key: str | None = None
    gemini_model: str = "gemini-1.5-flash"

    gmail_sender: str | None = None
    gmail_token_json: str = "./token.json"
    gmail_credentials_json: str = "./credentials.json"

    newsapi_daily_limit: int = 100
    min_score: float = 7.0
    max_articles_per_user: int = 8

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


@lru_cache
def get_settings() -> Settings:
    return Settings()
