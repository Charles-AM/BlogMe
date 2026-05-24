from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


CATEGORIES = ["sports", "entertainment", "education", "politics", "technology"]


@dataclass(slots=True)
class Article:
    title: str
    url: str
    source: str
    category: str
    published_at: datetime
    description: str = ""
    author: str | None = None
    upvotes: int = 0
    score: float = 0.0
    summary: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def normalized_url(self) -> str:
        return self.url.split("?")[0].rstrip("/")

    @classmethod
    def now(cls) -> datetime:
        return datetime.now(timezone.utc)
