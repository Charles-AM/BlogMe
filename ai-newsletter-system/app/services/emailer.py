import base64
from email.message import EmailMessage
from pathlib import Path

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from jinja2 import Environment, FileSystemLoader, select_autoescape

from app import database
from app.config import Settings
from app.models import Article


TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"
env = Environment(
    loader=FileSystemLoader(TEMPLATE_DIR),
    autoescape=select_autoescape(["html", "xml"]),
)


def render_email(
    *,
    recipient: str,
    unsubscribe_url: str,
    articles: list[Article],
) -> str:
    template = env.get_template("email.html")
    return template.render(recipient=recipient, unsubscribe_url=unsubscribe_url, articles=articles)


def send_gmail(settings: Settings, recipient: str, subject: str, html: str) -> str:
    if not settings.gmail_sender:
        database.log_api_usage("gmail", "send", 0, "dry_run", "GMAIL_SENDER missing")
        return "dry-run"

    token_path = Path(settings.gmail_token_json)
    if not token_path.exists():
        database.log_api_usage("gmail", "send", 0, "dry_run", "token.json missing")
        return "dry-run"

    credentials = Credentials.from_authorized_user_file(str(token_path), ["https://www.googleapis.com/auth/gmail.send"])
    service = build("gmail", "v1", credentials=credentials)

    message = EmailMessage()
    message["To"] = recipient
    message["From"] = settings.gmail_sender
    message["Subject"] = subject
    message.set_content("Your email client does not support HTML newsletters.")
    message.add_alternative(html, subtype="html")

    encoded = base64.urlsafe_b64encode(message.as_bytes()).decode()
    result = service.users().messages().send(userId="me", body={"raw": encoded}).execute()
    database.log_api_usage("gmail", "send", 1, "ok", result.get("id", "sent"))
    return result.get("id", "sent")
