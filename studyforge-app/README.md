# ExamGuide

ExamGuide is a browser-only exam practice app. Students upload a PDF or paste study text, choose either multiple choice or essay questions, answer the generated exam, then receive marks and feedback immediately.

## Files

- `index.html` - App structure and `pdf.js` loading.
- `styles.css` - Responsive interface, dark mode, exam cards, and feedback styles.
- `app.js` - PDF parsing, question generation, local marking, feedback, and Markdown export.

## Features

- Upload a PDF and extract text locally in the browser.
- Paste text directly for quick testing.
- Generate MCQ questions from key PDF terms and source sentences.
- Generate essay questions from detected topics.
- Assign marks per question.
- Submit answers and receive automatic scoring.
- MCQ feedback shows the correct answer.
- Essay feedback checks keyword coverage, answer length, and reasoning structure.
- Export marked results as Markdown.

## Run Locally

Open this folder in VS Code:

```bash
code /Users/charlie/Documents/Playground/studyforge-app
```

Then open `index.html` in your browser, or use the VS Code Live Server extension.

If the `code` command is not installed, open VS Code manually and choose **File > Open Folder...**, then select:

```text
/Users/charlie/Documents/Playground/studyforge-app
```

## Notes

- PDF extraction uses `pdf.js` from a CDN, so PDF upload requires internet access.
- No backend, database, or API key is required.
- Marking is heuristic because this MVP runs entirely locally without an AI backend.

## GitHub Starter Commands

```bash
cd /Users/charlie/Documents/Playground
git status
git add studyforge-app
git commit -m "Build ExamGuide PDF question practice app"
```
