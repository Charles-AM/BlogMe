from __future__ import annotations

import os
import re
from dataclasses import dataclass
from io import BytesIO

APP_TITLE = "Cover Letter Agent"
MAX_WORDS = 250
DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

BANNED_WORDS = {
    "can",
    "may",
    "just",
    "that",
    "very",
    "really",
    "literally",
    "actually",
    "certainly",
    "probably",
    "basically",
    "could",
    "maybe",
    "delve",
    "embark",
    "enlightening",
    "esteemed",
    "shed light",
    "craft",
    "crafting",
    "imagine",
    "realm",
    "game-changer",
    "unlock",
    "discover",
    "skyrocket",
    "abyss",
    "not alone",
    "in a world where",
    "revolutionize",
    "disruptive",
    "utilize",
    "utilizing",
    "dive deep",
    "tapestry",
    "illuminate",
    "unveil",
    "pivotal",
    "intricate",
    "elucidate",
    "hence",
    "furthermore",
    "however",
    "harness",
    "exciting",
    "groundbreaking",
    "cutting-edge",
    "remarkable",
    "it",
    "remains to be seen",
    "glimpse into",
    "navigating",
    "landscape",
    "stark",
    "testament",
    "in summary",
    "in conclusion",
    "moreover",
    "boost",
    "skyrocketing",
    "opened up",
    "powerful",
    "inquiries",
    "ever-evolving",
}


@dataclass(frozen=True)
class JobDetails:
    title: str
    company: str


def extract_pdf_text(uploaded_file: BytesIO) -> str:
    from pypdf import PdfReader

    reader = PdfReader(uploaded_file)
    pages = [page.extract_text() or "" for page in reader.pages]
    return clean_spacing("\n".join(pages))


def clean_spacing(text: str) -> str:
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", text))


def find_banned_terms(text: str) -> list[str]:
    lowered = text.lower()
    found = []
    for term in sorted(BANNED_WORDS):
        pattern = r"\b" + re.escape(term) + r"\b"
        if re.search(pattern, lowered):
            found.append(term)
    return found


def validate_cover_letter(text: str) -> list[str]:
    problems = []
    if "—" in text:
        problems.append("Remove em dashes.")
    if "*" in text or "#" in text:
        problems.append("Remove markdown characters.")
    if ";" in text:
        problems.append("Remove semicolons.")
    count = word_count(text)
    if count > MAX_WORDS:
        problems.append(f"Reduce to {MAX_WORDS} words or fewer. Current count: {count}.")
    banned = find_banned_terms(text)
    if banned:
        problems.append("Remove banned terms: " + ", ".join(banned[:12]) + ".")
    return problems


def infer_job_details(job_description: str) -> JobDetails:
    title = ""
    company = ""
    lines = [line.strip(" -|") for line in job_description.splitlines() if line.strip()]

    for line in lines[:12]:
        title_match = re.search(r"(?:job title|role|position)\s*:\s*(.+)", line, re.I)
        company_match = re.search(r"company\s*:\s*(.+)", line, re.I)
        if title_match and not title:
            title = title_match.group(1).strip()
        if company_match and not company:
            company = company_match.group(1).strip()

    if not title and lines:
        first = lines[0]
        if len(first.split()) <= 12:
            title = first

    if not company:
        joined = " ".join(lines[:8])
        at_match = re.search(r"\bat\s+([A-Z][A-Za-z0-9&., ]{1,60})", joined)
        if at_match:
            company = at_match.group(1).strip(" .,")

    return JobDetails(title=title or "the role", company=company or "your company")


def important_terms(text: str, limit: int = 14) -> list[str]:
    stop_words = {
        "and",
        "the",
        "for",
        "with",
        "from",
        "you",
        "your",
        "will",
        "this",
        "are",
        "our",
        "that",
        "have",
        "has",
        "their",
        "work",
        "team",
        "role",
        "job",
        "company",
        "skills",
        "experience",
    }
    terms = re.findall(r"\b[A-Za-z][A-Za-z+#.]{2,}\b", text)
    counts: dict[str, int] = {}
    for term in terms:
        key = term.lower()
        if key in stop_words:
            continue
        counts[key] = counts.get(key, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [term for term, _ in ranked[:limit]]


def matching_terms(resume_text: str, job_description: str) -> list[str]:
    resume_lower = resume_text.lower()
    matches = []
    for term in important_terms(job_description, limit=30):
        if term in resume_lower and term not in matches:
            matches.append(term)
    return matches[:6]


def first_resume_name(resume_text: str) -> str:
    for line in resume_text.splitlines()[:8]:
        words = line.strip().split()
        if 1 < len(words) <= 4 and all(part[:1].isupper() for part in words if part):
            return line.strip()
    return "Your Name"


def fallback_cover_letter(
    resume_text: str,
    job_description: str,
    provided_details: JobDetails | None = None,
) -> str:
    details = provided_details or infer_job_details(job_description)
    name = first_resume_name(resume_text)
    matches = matching_terms(resume_text, job_description)
    selected = matches[:3] or important_terms(job_description, limit=3)
    skill_sentence = ", ".join(selected[:3]) if selected else "the work your team needs"

    return clean_spacing(
        f"I am applying for the {details.title} role at {details.company}.\n\n"
        f"I bring direct experience in {skill_sentence}. My resume shows a record of shipping work, solving user problems, and turning requirements into clear outcomes.\n\n"
        f"For the role, I would focus on three priorities. First, I would learn your goals and translate them into practical work. Second, I would apply my strongest skills to the requirements listed in the job description. Third, I would communicate progress in plain language so your team has fewer surprises.\n\n"
        f"My background fits the work because I have handled similar responsibilities and produced measurable results. I would bring a direct, organized approach from day one.\n\n"
        f"{name}"
    )


def system_prompt() -> str:
    banned = ", ".join(sorted(BANNED_WORDS))
    return f"""
You write cover letters from a resume and job description.

Rules:
First sentence states the specific job title and company.
Use clear, simple language.
Use short, direct sentences.
Use active voice.
Match resume skills to 2 or 3 requirements from the job description.
Rephrase resume content. Do not copy resume phrases word for word.
Do not ask questions.
Stay under {MAX_WORDS} words.
No markdown.
No asterisks.
No em dashes.
No semicolons.
Avoid these exact words and phrases: {banned}.
Return only the cover letter.
""".strip()


def build_user_prompt(resume_text: str, job_description: str, details: JobDetails) -> str:
    return f"""
Specific job title: {details.title}
Specific company: {details.company}

Resume:
{resume_text[:12000]}

Job description:
{job_description[:8000]}
""".strip()


def openai_cover_letter(
    resume_text: str,
    job_description: str,
    model: str,
    details: JobDetails,
) -> str:
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise RuntimeError("Install the openai package to use API generation.") from exc

    client = OpenAI()
    response = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": system_prompt()},
            {"role": "user", "content": build_user_prompt(resume_text, job_description, details)},
        ],
        temperature=0.3,
    )
    return clean_spacing(response.output_text)


def repair_cover_letter(
    cover_letter: str,
    resume_text: str,
    job_description: str,
    model: str,
    details: JobDetails,
    problems: list[str],
) -> str:
    try:
        from openai import OpenAI
    except ImportError:
        return cover_letter

    client = OpenAI()
    response = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": system_prompt()},
            {
                "role": "user",
                "content": (
                    "Revise this cover letter to fix every issue listed. "
                    "Return only the revised letter.\n\n"
                    f"Issues:\n{chr(10).join(problems)}\n\n"
                    f"Specific job title: {details.title}\n"
                    f"Specific company: {details.company}\n\n"
                    f"Resume:\n{resume_text[:8000]}\n\n"
                    f"Job description:\n{job_description[:6000]}\n\n"
                    f"Cover letter:\n{cover_letter}"
                ),
            },
        ],
        temperature=0.2,
    )
    return clean_spacing(response.output_text)


def generate_cover_letter(
    resume_text: str,
    job_description: str,
    model: str,
    details: JobDetails,
) -> tuple[str, list[str], str]:
    source = "Local fallback"
    if os.getenv("OPENAI_API_KEY"):
        source = f"OpenAI API, {model}"
        letter = openai_cover_letter(resume_text, job_description, model, details)
        problems = validate_cover_letter(letter)
        for _ in range(2):
            if not problems:
                break
            letter = repair_cover_letter(letter, resume_text, job_description, model, details, problems)
            problems = validate_cover_letter(letter)
        return letter, problems, source

    letter = fallback_cover_letter(resume_text, job_description, details)
    return letter, validate_cover_letter(letter), source


def main() -> None:
    import streamlit as st

    st.set_page_config(page_title=APP_TITLE, page_icon=":memo:", layout="wide")

    st.title(APP_TITLE)
    st.caption("Upload a resume PDF, paste a job description, and generate a concise cover letter.")

    with st.sidebar:
        st.header("Settings")
        model = st.text_input("OpenAI model", value=DEFAULT_MODEL)
        st.caption("Set OPENAI_API_KEY in your environment to use API generation.")

    resume_file = st.file_uploader("Resume PDF", type=["pdf"])
    job_description = st.text_area("Job description", height=320)
    detail_columns = st.columns(2)
    job_title = detail_columns[0].text_input("Job title")
    company = detail_columns[1].text_input("Company")

    generate = st.button("Generate cover letter", type="primary")

    if generate:
        if resume_file is None:
            st.error("Upload a resume PDF.")
        elif not job_description.strip():
            st.error("Paste the job description.")
        else:
            with st.spinner("Reading resume and writing cover letter..."):
                try:
                    resume_text = extract_pdf_text(resume_file)
                    if not resume_text:
                        st.error("No text was found in the PDF. Try a text-based resume PDF.")
                        st.stop()

                    inferred = infer_job_details(job_description)
                    details = JobDetails(
                        title=job_title.strip() or inferred.title,
                        company=company.strip() or inferred.company,
                    )
                    letter, problems, source = generate_cover_letter(
                        resume_text,
                        job_description,
                        model,
                        details,
                    )
                except Exception as exc:
                    st.error(str(exc))
                    st.stop()

            st.subheader("Cover letter")
            st.text_area("Generated output", value=letter, height=360)

            metrics = st.columns(3)
            metrics[0].metric("Words", word_count(letter))
            metrics[1].metric("Generator", source)
            metrics[2].metric("Style issues", len(problems))

            if problems:
                st.warning("Style checks need review: " + " ".join(problems))
            else:
                st.success("Style checks passed.")


if __name__ == "__main__":
    main()
