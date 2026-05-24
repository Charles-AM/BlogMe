from __future__ import annotations

import html
import os
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote_plus

from cover_letter_agent import JobDetails, generate_cover_letter, infer_job_details, validate_cover_letter, word_count


HOST = "127.0.0.1"
PORT = int(os.getenv("PORT", "8502"))


PAGE = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cover Letter Agent</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17202a;
      --muted: #667085;
      --line: #d7dde5;
      --paper: #fbfcfe;
      --accent: #0b766f;
      --accent-dark: #075b55;
      --warn: #9a3412;
      --ok: #166534;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: #eef2f6;
    }
    header {
      border-bottom: 1px solid var(--line);
      background: #ffffff;
    }
    .wrap {
      width: min(1120px, calc(100vw - 32px));
      margin: 0 auto;
    }
    .top {
      padding: 22px 0 18px;
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 24px;
    }
    h1 {
      margin: 0;
      font-size: 26px;
      line-height: 1.1;
      letter-spacing: 0;
    }
    .sub {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 14px;
    }
    main {
      padding: 24px 0 36px;
    }
    form {
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 18px;
      align-items: start;
    }
    section {
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 700;
      margin: 0 0 7px;
    }
    input[type="text"], input[type="file"], textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px 11px;
      font: inherit;
      font-size: 14px;
      background: var(--paper);
      color: var(--ink);
    }
    textarea {
      min-height: 310px;
      resize: vertical;
      line-height: 1.45;
    }
    .field {
      margin-bottom: 14px;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    button {
      width: 100%;
      border: 0;
      border-radius: 6px;
      background: var(--accent);
      color: #ffffff;
      font-weight: 800;
      font-size: 14px;
      padding: 12px 14px;
      cursor: pointer;
    }
    button:hover {
      background: var(--accent-dark);
    }
    .result {
      margin-top: 18px;
    }
    .letter {
      white-space: pre-wrap;
      min-height: 280px;
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      line-height: 1.45;
      font-size: 15px;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 12px 0;
      color: var(--muted);
      font-size: 13px;
    }
    .pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 5px 9px;
      background: #ffffff;
    }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    @media (max-width: 860px) {
      form { grid-template-columns: 1fr; }
      .grid-2 { grid-template-columns: 1fr; }
      .top { display: block; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap top">
      <div>
        <h1>Cover Letter Agent</h1>
        <p class="sub">Upload your resume PDF, paste a job description, and generate a concise cover letter.</p>
      </div>
      <p class="sub">Uses OpenAI when OPENAI_API_KEY is set. Uses local fallback otherwise.</p>
    </div>
  </header>
  <main class="wrap">
    <form method="post" action="/generate" enctype="multipart/form-data">
      <section>
        <div class="field">
          <label for="resume">Resume PDF</label>
          <input id="resume" name="resume" type="file" accept="application/pdf" required>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="job_title">Job title</label>
            <input id="job_title" name="job_title" type="text" value="{job_title}">
          </div>
          <div class="field">
            <label for="company">Company</label>
            <input id="company" name="company" type="text" value="{company}">
          </div>
        </div>
        <div class="field">
          <label for="model">OpenAI model</label>
          <input id="model" name="model" type="text" value="{model}">
        </div>
        <button type="submit">Generate cover letter</button>
      </section>
      <section>
        <label for="job_description">Job description</label>
        <textarea id="job_description" name="job_description" required>{job_description}</textarea>
      </section>
    </form>
    {result}
  </main>
</body>
</html>
"""


def page(
    result: str = "",
    job_description: str = "",
    job_title: str = "",
    company: str = "",
    model: str = "gpt-4.1-mini",
) -> bytes:
    rendered = PAGE
    rendered = rendered.replace("{result}", result)
    rendered = rendered.replace("{job_description}", html.escape(job_description))
    rendered = rendered.replace("{job_title}", html.escape(job_title))
    rendered = rendered.replace("{company}", html.escape(company))
    rendered = rendered.replace("{model}", html.escape(model))
    return rendered.encode("utf-8")


def parse_headers(header_blob: bytes) -> dict[str, str]:
    headers = {}
    for raw_line in header_blob.decode("utf-8", "replace").split("\r\n"):
        if ":" in raw_line:
            key, value = raw_line.split(":", 1)
            headers[key.lower()] = value.strip()
    return headers


def parse_content_disposition(value: str) -> dict[str, str]:
    parts = [part.strip() for part in value.split(";")]
    parsed = {}
    for part in parts[1:]:
        if "=" in part:
            key, raw = part.split("=", 1)
            parsed[key.strip()] = raw.strip().strip('"')
    return parsed


def parse_multipart(body: bytes, content_type: str) -> dict[str, bytes]:
    match = re.search(r"boundary=(.+)", content_type)
    if not match:
        return {}
    boundary = ("--" + match.group(1).strip('"')).encode()
    fields: dict[str, bytes] = {}
    for part in body.split(boundary):
        part = part.strip()
        if not part or part == b"--":
            continue
        if part.endswith(b"--"):
            part = part[:-2].rstrip()
        if b"\r\n\r\n" not in part:
            continue
        header_blob, value = part.split(b"\r\n\r\n", 1)
        headers = parse_headers(header_blob)
        disposition = parse_content_disposition(headers.get("content-disposition", ""))
        name = disposition.get("name")
        if name:
            fields[name] = value.rstrip(b"\r\n")
    return fields


def decode_field(fields: dict[str, bytes], name: str) -> str:
    return unquote_plus(fields.get(name, b"").decode("utf-8", "replace")).strip()


def render_result(letter: str, problems: list[str], source: str) -> str:
    status = "Style checks passed." if not problems else "Style checks need review: " + " ".join(problems)
    status_class = "ok" if not problems else "warn"
    return f"""
    <section class="result">
      <h2>Cover letter</h2>
      <div class="meta">
        <span class="pill">Words: {word_count(letter)}</span>
        <span class="pill">Generator: {html.escape(source)}</span>
        <span class="pill {status_class}">{html.escape(status)}</span>
      </div>
      <div class="letter">{html.escape(letter)}</div>
    </section>
    """


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.respond(page())

    def do_POST(self) -> None:
        if self.path != "/generate":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        length = int(self.headers.get("content-length", "0"))
        content_type = self.headers.get("content-type", "")
        fields = parse_multipart(self.rfile.read(length), content_type)
        job_description = decode_field(fields, "job_description")
        job_title = decode_field(fields, "job_title")
        company = decode_field(fields, "company")
        model = decode_field(fields, "model") or "gpt-4.1-mini"
        resume = fields.get("resume", b"")

        if not resume or not job_description:
            result = '<section class="result"><p class="warn">Upload a resume PDF and paste a job description.</p></section>'
            self.respond(page(result, job_description, job_title, company, model), HTTPStatus.BAD_REQUEST)
            return

        try:
            from io import BytesIO

            from cover_letter_agent import extract_pdf_text

            resume_text = extract_pdf_text(BytesIO(resume))
            inferred = infer_job_details(job_description)
            details = JobDetails(title=job_title or inferred.title, company=company or inferred.company)
            letter, problems, source = generate_cover_letter(resume_text, job_description, model, details)
            problems = problems or validate_cover_letter(letter)
            result = render_result(letter, problems, source)
            self.respond(page(result, job_description, details.title, details.company, model))
        except Exception as exc:
            result = f'<section class="result"><p class="warn">{html.escape(str(exc))}</p></section>'
            self.respond(page(result, job_description, job_title, company, model), HTTPStatus.INTERNAL_SERVER_ERROR)

    def respond(self, body: bytes, status: HTTPStatus = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Cover Letter Agent running at http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
