const STOP_WORDS = new Set([
  "about", "above", "after", "again", "against", "almost", "also", "although", "always",
  "among", "because", "before", "being", "between", "both", "could", "during", "each",
  "either", "every", "example", "first", "from", "have", "having", "into", "itself",
  "many", "more", "most", "other", "over", "same", "should", "since", "some", "such",
  "than", "that", "their", "them", "then", "there", "these", "they", "this", "those",
  "through", "under", "using", "very", "were", "when", "where", "which", "while",
  "with", "within", "would", "your", "chapter", "section", "question", "answer"
]);

const els = {
  pdfFile: document.getElementById("pdfFile"),
  sourceText: document.getElementById("sourceText"),
  questionMode: document.getElementById("questionMode"),
  questionCount: document.getElementById("questionCount"),
  marksEach: document.getElementById("marksEach"),
  status: document.getElementById("status"),
  generateBtn: document.getElementById("generateBtn"),
  demoBtn: document.getElementById("demoBtn"),
  themeBtn: document.getElementById("themeBtn"),
  clearBtn: document.getElementById("clearBtn"),
  emptyState: document.getElementById("emptyState"),
  results: document.getElementById("results"),
  examView: document.getElementById("examView"),
  resultsView: document.getElementById("resultsView"),
  sourceView: document.getElementById("sourceView")
};

let appState = {
  sourceText: "",
  mode: "mcq",
  questions: [],
  graded: null
};

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

els.generateBtn.addEventListener("click", generateExam);
els.demoBtn.addEventListener("click", loadDemo);
els.themeBtn.addEventListener("click", toggleTheme);
els.clearBtn.addEventListener("click", clearAll);

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

async function generateExam() {
  try {
    setStatus("Reading source...");
    els.generateBtn.disabled = true;

    const pastedText = els.sourceText.value.trim();
    const pdfText = await readPdfText(els.pdfFile.files[0]);
    const sourceText = cleanText(`${pdfText}\n${pastedText}`);

    if (countWords(sourceText) < 40) {
      setStatus("Add a PDF or paste at least 40 words of study material.");
      return;
    }

    const questionCount = clamp(Number(els.questionCount.value) || 8, 1, 20);
    const marksEach = clamp(Number(els.marksEach.value) || 5, 1, 25);
    const mode = els.questionMode.value;
    const terms = extractKeyTerms(sourceText);
    const sentences = extractSentences(sourceText);
    const questions = mode === "mcq"
      ? buildMcqQuestions(sentences, terms, questionCount, marksEach)
      : buildEssayQuestions(sentences, terms, questionCount, marksEach);

    appState = {
      sourceText,
      mode,
      questions,
      graded: null,
      stats: {
        words: countWords(sourceText),
        terms: terms.slice(0, 16)
      }
    };

    render();
    activateTab("exam");
    setStatus(`Generated ${questions.length} ${mode === "mcq" ? "MCQ" : "essay"} questions.`);
  } catch (error) {
    console.error(error);
    setStatus(`Could not generate exam: ${error.message}`);
  } finally {
    els.generateBtn.disabled = false;
  }
}

async function readPdfText(file) {
  if (!file) return "";
  if (!window.pdfjsLib) {
    throw new Error("pdf.js did not load. Check your internet connection, or paste text instead.");
  }

  setStatus(`Parsing PDF: ${file.name}`);
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    setStatus(`Parsing PDF page ${pageNum} of ${pdf.numPages}...`);
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }

  return cleanText(pages.join("\n"));
}

function buildMcqQuestions(sentences, terms, questionCount, marksEach) {
  const usableTerms = terms.length >= 4 ? terms : ["concept", "process", "definition", "example"];
  const candidates = sentences
    .map((sentence) => {
      const answer = usableTerms.find((term) => includesTerm(sentence, term));
      return answer ? { sentence, answer } : null;
    })
    .filter(Boolean);

  const source = candidates.length ? candidates : usableTerms.map((term) => ({
    answer: term,
    sentence: `${titleCase(term)} is an important idea from the uploaded material.`
  }));

  return Array.from({ length: questionCount }, (_, index) => {
    const item = source[index % source.length];
    const answer = item.answer;
    const prompt = makeMcqPrompt(item.sentence, answer);
    const distractors = usableTerms
      .filter((term) => normalize(term) !== normalize(answer))
      .slice(index, index + 12);
    const options = shuffle(uniqueByNormalized([answer, ...distractors]).slice(0, 4));

    while (options.length < 4) {
      options.push(["Analysis", "Evidence", "Conclusion", "Method"][options.length]);
    }

    return {
      id: index + 1,
      type: "mcq",
      marks: marksEach,
      prompt,
      options,
      answer,
      source: item.sentence,
      feedbackHint: `Review the sentence: "${item.sentence}"`
    };
  });
}

function buildEssayQuestions(sentences, terms, questionCount, marksEach) {
  const topics = terms.length ? terms : ["the main idea", "the evidence", "the process", "the conclusion"];
  const stems = [
    "Explain the importance of",
    "Discuss how",
    "Evaluate the role of",
    "Compare the key ideas connected to",
    "Analyze why"
  ];

  return Array.from({ length: questionCount }, (_, index) => {
    const topic = topics[index % topics.length];
    const related = sentences.filter((sentence) => includesTerm(sentence, topic)).slice(0, 3);
    const keywords = uniqueByNormalized([
      topic,
      ...extractKeyTerms(related.join(" ")).slice(0, 5)
    ]).slice(0, 6);

    return {
      id: index + 1,
      type: "essay",
      marks: marksEach,
      prompt: `${stems[index % stems.length]} ${topic} in the uploaded material.`,
      keywords,
      source: related[0] || sentences[index % sentences.length] || "",
      feedbackHint: `Strong answers should mention: ${keywords.join(", ")}.`
    };
  });
}

function makeMcqPrompt(sentence, answer) {
  const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`, "i");
  const blanked = sentence.replace(pattern, "_____");
  if (blanked !== sentence) {
    return `Which option best completes this statement? ${blanked}`;
  }
  return `Which term is most closely connected to this idea? ${sentence}`;
}

function render() {
  els.emptyState.hidden = true;
  els.results.hidden = false;
  renderExam();
  renderResults();
  renderSource();
}

function renderExam() {
  const totalMarks = appState.questions.reduce((sum, question) => sum + question.marks, 0);
  els.examView.innerHTML = `
    <div class="summary-row">
      ${stat("Mode", appState.mode === "mcq" ? "MCQ" : "Essay")}
      ${stat("Questions", appState.questions.length)}
      ${stat("Total Marks", totalMarks)}
      ${stat("Source Words", appState.stats.words)}
    </div>
    <form id="examForm">
      ${appState.questions.map(renderQuestion).join("")}
      <div class="mini-toolbar">
        <button class="btn primary" type="submit">Submit Answers</button>
        <button class="btn" type="button" id="exportBtn">Export Results</button>
      </div>
    </form>
  `;

  document.getElementById("examForm").addEventListener("submit", (event) => {
    event.preventDefault();
    gradeExam(new FormData(event.target));
  });

  document.getElementById("exportBtn").addEventListener("click", exportResults);
}

function renderQuestion(question) {
  if (question.type === "mcq") {
    return `
      <article class="question-card">
        <h3>${question.id}. ${escapeHtml(question.prompt)}</h3>
        <div class="question-meta">
          <span class="pill">${question.marks} marks</span>
          <span class="pill gold">MCQ</span>
        </div>
        ${question.options.map((option) => `
          <label class="choice">
            <input type="radio" name="q${question.id}" value="${escapeHtml(option)}">
            ${escapeHtml(option)}
          </label>
        `).join("")}
      </article>
    `;
  }

  return `
    <article class="question-card">
      <h3>${question.id}. ${escapeHtml(question.prompt)}</h3>
      <div class="question-meta">
        <span class="pill">${question.marks} marks</span>
        <span class="pill gold">Essay</span>
      </div>
      <textarea class="answer" name="q${question.id}" placeholder="Write your answer here..."></textarea>
    </article>
  `;
}

function gradeExam(formData) {
  const feedback = appState.questions.map((question) => {
    const answer = String(formData.get(`q${question.id}`) || "").trim();
    return question.type === "mcq"
      ? gradeMcq(question, answer)
      : gradeEssay(question, answer);
  });

  const earned = feedback.reduce((sum, item) => sum + item.score, 0);
  const total = appState.questions.reduce((sum, question) => sum + question.marks, 0);
  const percent = total ? Math.round((earned / total) * 100) : 0;

  appState.graded = { feedback, earned, total, percent };
  renderResults();
  activateTab("results");
  setStatus(`Marked: ${earned}/${total} (${percent}%).`);
}

function gradeMcq(question, answer) {
  const correct = normalize(answer) === normalize(question.answer);
  return {
    id: question.id,
    type: "mcq",
    answer: answer || "No answer selected",
    correctAnswer: question.answer,
    score: correct ? question.marks : 0,
    marks: question.marks,
    status: correct ? "correct" : "incorrect",
    feedback: correct
      ? "Correct. You identified the key term from the source."
      : `Incorrect. The best answer is "${question.answer}". ${question.feedbackHint}`
  };
}

function gradeEssay(question, answer) {
  const words = countWords(answer);
  const normalizedAnswer = normalize(answer);
  const matchedKeywords = question.keywords.filter((keyword) => normalizedAnswer.includes(normalize(keyword)));
  const keywordRatio = question.keywords.length ? matchedKeywords.length / question.keywords.length : 0;
  const lengthRatio = Math.min(1, words / 90);
  const structureBonus = /\b(because|therefore|however|for example|in conclusion|evidence|shows)\b/i.test(answer) ? 0.12 : 0;
  const rawRatio = Math.min(1, keywordRatio * 0.62 + lengthRatio * 0.26 + structureBonus);
  const score = Math.round(rawRatio * question.marks);
  const status = score === question.marks ? "correct" : score > 0 ? "partial" : "incorrect";

  const missing = question.keywords.filter((keyword) => !matchedKeywords.includes(keyword));
  const feedbackParts = [];

  if (!answer) {
    feedbackParts.push("No answer was entered.");
  } else {
    feedbackParts.push(`Matched ${matchedKeywords.length}/${question.keywords.length} expected keywords.`);
    if (words < 60) feedbackParts.push("Add more explanation, evidence, and examples for a stronger essay answer.");
    if (missing.length) feedbackParts.push(`Try adding: ${missing.slice(0, 4).join(", ")}.`);
    if (!structureBonus) feedbackParts.push("Use clearer reasoning words such as because, however, evidence, or therefore.");
  }

  return {
    id: question.id,
    type: "essay",
    answer,
    correctAnswer: question.feedbackHint,
    score,
    marks: question.marks,
    status,
    feedback: feedbackParts.join(" ")
  };
}

function renderResults() {
  if (!appState.graded) {
    els.resultsView.innerHTML = `
      <div class="empty">
        <div>
          <strong>No marks yet.</strong>
          Submit your answers on the Exam tab to see scores and feedback.
        </div>
      </div>
    `;
    return;
  }

  const { feedback, earned, total, percent } = appState.graded;
  els.resultsView.innerHTML = `
    <div class="summary-row">
      ${stat("Score", `${earned}/${total}`)}
      ${stat("Percent", `${percent}%`)}
      ${stat("Marked Items", feedback.length)}
    </div>
    ${feedback.map(renderFeedback).join("")}
  `;
}

function renderFeedback(item) {
  return `
    <article class="feedback-card ${item.status}">
      <h3>Question ${item.id}</h3>
      <div class="feedback-meta">
        <span class="pill ${item.status === "correct" ? "green" : item.status === "partial" ? "gold" : "red"}">
          ${item.score}/${item.marks} marks
        </span>
        <span class="pill">${item.type.toUpperCase()}</span>
      </div>
      <p><strong>Your answer:</strong> ${escapeHtml(item.answer || "No answer")}</p>
      <p><strong>Expected:</strong> ${escapeHtml(item.correctAnswer)}</p>
      <p class="muted"><strong>Feedback:</strong> ${escapeHtml(item.feedback)}</p>
    </article>
  `;
}

function renderSource() {
  const terms = appState.stats?.terms || [];
  els.sourceView.innerHTML = `
    <div class="source-card">
      <h2 class="section-title">Detected Keywords</h2>
      <div class="question-meta">
        ${terms.map((term) => `<span class="pill">${escapeHtml(term)}</span>`).join("")}
      </div>
    </div>
    <div class="source-card">
      <h2 class="section-title">Extracted Source Text</h2>
      <div class="source-text">${escapeHtml(appState.sourceText)}</div>
    </div>
  `;
}

function exportResults() {
  const lines = [
    "# ExamGuide Results",
    "",
    `Mode: ${appState.mode === "mcq" ? "MCQ" : "Essay"}`,
    `Questions: ${appState.questions.length}`,
    ""
  ];

  if (appState.graded) {
    lines.push(`Score: ${appState.graded.earned}/${appState.graded.total} (${appState.graded.percent}%)`, "");
  }

  appState.questions.forEach((question) => {
    lines.push(`## Question ${question.id}`);
    lines.push(question.prompt);
    lines.push(`Marks: ${question.marks}`);
    if (question.type === "mcq") {
      lines.push(`Correct answer: ${question.answer}`);
    } else {
      lines.push(`Expected keywords: ${question.keywords.join(", ")}`);
    }
    const marked = appState.graded?.feedback.find((item) => item.id === question.id);
    if (marked) {
      lines.push(`Student answer: ${marked.answer}`);
      lines.push(`Score: ${marked.score}/${marked.marks}`);
      lines.push(`Feedback: ${marked.feedback}`);
    }
    lines.push("");
  });

  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "examguide-results.md";
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Exported results as Markdown.");
}

function extractSentences(text) {
  return cleanText(text)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 55 && sentence.length <= 260)
    .slice(0, 120);
}

function extractKeyTerms(text) {
  const words = cleanText(text)
    .toLowerCase()
    .match(/[a-z][a-z-]{3,}/g) || [];

  const counts = words.reduce((map, word) => {
    const clean = word.replace(/^-|-$/g, "");
    if (STOP_WORDS.has(clean)) return map;
    map.set(clean, (map.get(clean) || 0) + 1);
    return map;
  }, new Map());

  const singleTerms = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);

  const phrases = extractPhrases(text);
  return uniqueByNormalized([...phrases, ...singleTerms]).slice(0, 40);
}

function extractPhrases(text) {
  const matches = cleanText(text).match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g) || [];
  return matches
    .filter((phrase) => countWords(phrase) <= 4)
    .slice(0, 18);
}

function includesTerm(sentence, term) {
  return normalize(sentence).includes(normalize(term));
}

function cleanText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueByNormalized(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalize(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shuffle(items) {
  return [...items]
    .map((item) => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ item }) => item);
}

function titleCase(value) {
  return String(value || "").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stat(label, value) {
  return `<div class="stat"><span>${label}</span><b>${escapeHtml(value)}</b></div>`;
}

function activateTab(name) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === name);
  });

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `${name}View`);
  });
}

function setStatus(message) {
  els.status.textContent = message;
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = current === "dark" ? "" : "dark";
}

function clearAll() {
  els.pdfFile.value = "";
  els.sourceText.value = "";
  els.questionMode.value = "mcq";
  els.questionCount.value = 8;
  els.marksEach.value = 5;
  appState = {
    sourceText: "",
    mode: "mcq",
    questions: [],
    graded: null
  };
  els.emptyState.hidden = false;
  els.results.hidden = true;
  setStatus("Cleared.");
}

function loadDemo() {
  els.questionMode.value = "mcq";
  els.questionCount.value = 6;
  els.marksEach.value = 5;
  els.sourceText.value = `Photosynthesis is the process by which green plants use sunlight to synthesize food from carbon dioxide and water. Chlorophyll absorbs light energy and helps convert it into chemical energy stored in glucose. The light-dependent reactions occur in the thylakoid membranes and produce ATP and NADPH. The Calvin cycle occurs in the stroma, where carbon dioxide is fixed into sugar molecules. Cellular respiration releases energy from glucose through glycolysis, the Krebs cycle, and oxidative phosphorylation. Mitochondria are the main site of aerobic respiration in eukaryotic cells. Enzymes are biological catalysts that lower activation energy and increase the rate of chemical reactions. Temperature and pH can affect enzyme shape and activity.`;
  setStatus("Demo text loaded. Click Generate Exam.");
}
