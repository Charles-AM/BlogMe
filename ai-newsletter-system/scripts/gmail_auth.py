import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

from google_auth_oauthlib.flow import InstalledAppFlow

from app.config import get_settings


SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


if __name__ == "__main__":
    settings = get_settings()
    credentials_path = Path(settings.gmail_credentials_json)
    if not credentials_path.exists():
        raise SystemExit(f"Missing OAuth client file: {credentials_path}")

    flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SCOPES)
    credentials = flow.run_local_server(port=0)
    Path(settings.gmail_token_json).write_text(credentials.to_json())
    print(f"Saved Gmail token to {settings.gmail_token_json}")
