import { adminUid, firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytesResumable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const page = document.body.dataset.page;
const RECENT_POSTS_COLLAPSED_COUNT = 3;
const JIKAN_CACHE_TTL = 1000 * 60 * 60 * 6;
let homePosts = [];
let currentRankings = [];
let areRecentPostsExpanded = false;

const AI_REVIEW_PROMPT =
  "Write a short anime review (150-300 words) as a passionate human journalist. Use short sentences, occasional humor, genuine emotion, and a natural voice. Avoid bullet points, lists, and formal language. Make it feel personal, like a friend recommending an anime. Do not include any AI-sounding phrases such as 'as an AI' or 'in conclusion'. Just write the review.";

const $ = (selector) => document.querySelector(selector);

function hasConfiguredFirebase() {
  return !Object.values(firebaseConfig).some((value) => String(value).startsWith("YOUR_"));
}

function toDate(value) {
  if (!value) return new Date();
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
}

function formatDate(value) {
  return toDate(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function formatMonth(value) {
  return toDate(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long"
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function slugify(value = "") {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function excerpt(content = "", max = 150) {
  const plain = content.replace(/[#*_`>-]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max).trim()}...` : plain;
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags;
  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getRecommendationTopic(item = {}) {
  return item.topicTitle || item.listTitle || item.topic || item.genre || "Recommendations";
}

function getRecommendationLabel(item = {}) {
  return item.genre || item.type || "Recommendation";
}

function getRankValue(item = {}) {
  const rank = Number(item.rank);
  return Number.isFinite(rank) && rank > 0 ? rank : Number.MAX_SAFE_INTEGER;
}

function getRatingValue(item = {}) {
  const rating = Number(item.rating);
  return Number.isFinite(rating) ? Math.min(Math.max(rating, 0), 10) : 0;
}

function sortRecommendations(items = []) {
  return [...items].sort((a, b) => (
    getRankValue(a) - getRankValue(b)
    || getRatingValue(b) - getRatingValue(a)
    || String(a.title || "").localeCompare(String(b.title || ""))
  ));
}

function groupRankingsByTopic(rankings = []) {
  return rankings.reduce((result, item) => {
    const key = getRecommendationTopic(item);
    result[key] = result[key] || [];
    result[key].push(item);
    return result;
  }, {});
}

function sortRecommendationGroupEntries(entries = []) {
  return [...entries].sort(([topicA, itemsA], [topicB, itemsB]) => {
    const bestRankA = Math.min(...itemsA.map(getRankValue));
    const bestRankB = Math.min(...itemsB.map(getRankValue));
    return bestRankA - bestRankB || topicA.localeCompare(topicB);
  });
}

function getRecommendationDate(items = []) {
  const dates = items
    .map((item) => item.updatedAt || item.createdAt || item.date)
    .filter(Boolean)
    .map(toDate)
    .filter((date) => !Number.isNaN(date.getTime()));
  return dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : new Date();
}

function buildRecommendationLists(rankings = []) {
  const groups = groupRankingsByTopic(rankings);

  return sortRecommendationGroupEntries(Object.entries(groups)).map(([topic, items]) => {
    const sortedItems = sortRecommendations(items);
    const first = sortedItems[0] || {};
    const labels = [...new Set(sortedItems
      .map(getRecommendationLabel)
      .filter((label) => label && label !== topic && label.length < 28)
    )].slice(0, 3);
    const titles = sortedItems.slice(0, 4).map((item) => item.title).filter(Boolean).join(", ");
    return {
      id: slugify(topic),
      kind: "recommendation",
      title: topic,
      imageUrl: first.imageUrl || "assets/regressed-ranker-hero.jpg",
      content: titles,
      date: getRecommendationDate(sortedItems),
      category: "Recommendations",
      tags: labels,
      items: sortedItems,
      href: `recommendations.html?topic=${encodeURIComponent(topic)}`
    };
  }).sort((a, b) => toDate(b.date) - toDate(a.date));
}

function sortFeedItems(items = []) {
  return [...items].sort((a, b) => toDate(b.date) - toDate(a.date));
}

function showMessage(node, message, isError = false) {
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error", isError);
}

function authErrorMessage(error) {
  const messages = {
    "auth/invalid-credential": "Firebase says those credentials do not match an admin user.",
    "auth/user-not-found": "No Firebase Auth user exists for that email.",
    "auth/wrong-password": "Firebase says the password is incorrect.",
    "auth/invalid-email": "That email address is not valid.",
    "auth/operation-not-allowed": "Email/password sign-in is not enabled in Firebase Authentication.",
    "auth/network-request-failed": "Firebase could not be reached. Check your connection and local server."
  };
  return messages[error?.code] || `Sign-in failed: ${error?.code || "unknown error"}`;
}

function setLoading(button, loadingText, isLoading) {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function imageExtension(file) {
  const fallback = file.type === "image/png" ? "png" : "jpg";
  return file.name?.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || fallback;
}

function compressImage(file, maxWidth = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Only image files can be uploaded."));
      return;
    }

    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxWidth / image.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Could not prepare image for upload."));
          return;
        }
        resolve(new File([blob], file.name || "upload.jpg", { type: "image/jpeg" }));
      }, "image/jpeg", quality);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read the pasted image."));
    };

    image.src = objectUrl;
  });
}

async function uploadPastedImage(file, folder, onProgress) {
  if (!auth.currentUser) throw new Error("Sign in before uploading images.");
  const uploadFile = await compressImage(file);
  const extension = imageExtension(uploadFile);
  const path = `uploads/${folder}/${auth.currentUser.uid}-${Date.now()}.${extension}`;
  const imageReference = storageRef(storage, path);
  const uploadTask = uploadBytesResumable(imageReference, uploadFile, { contentType: uploadFile.type || "image/jpeg" });

  return new Promise((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        onProgress?.(percent);
      },
      reject,
      async () => {
        resolve(await getDownloadURL(uploadTask.snapshot.ref));
      }
    );
  });
}

function setupImagePaste(input, folder, messageNode) {
  if (!input) return;

  input.addEventListener("paste", async (event) => {
    const file = [...(event.clipboardData?.items || [])]
      .find((item) => item.type.startsWith("image/"))
      ?.getAsFile();

    if (!file) return;
    event.preventDefault();
    input.placeholder = "Uploading pasted image...";
    showMessage(messageNode, "Preparing image...");

    try {
      input.value = await uploadPastedImage(file, folder, (percent) => {
        showMessage(messageNode, `Uploading image... ${percent}%`);
      });
      showMessage(messageNode, "Image uploaded. The URL is ready.");
    } catch (error) {
      console.error("Image upload failed:", error);
      const detail = error?.code ? ` (${error.code})` : "";
      showMessage(messageNode, `Image upload failed${detail}. Check Firebase Storage setup and rules.`, true);
    } finally {
      input.placeholder = "Paste image, local file, or image URL";
    }
  });
}

function parseMarkdown(content = "") {
  const lines = escapeHtml(content).split(/\n{2,}/);
  return lines
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("### ")) return `<h3>${trimmed.slice(4)}</h3>`;
      if (trimmed.startsWith("## ")) return `<h2>${trimmed.slice(3)}</h2>`;
      if (trimmed.startsWith("# ")) return `<h2>${trimmed.slice(2)}</h2>`;
      const withInline = trimmed
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>");
      return `<p>${withInline.replaceAll("\n", "<br>")}</p>`;
    })
    .join("");
}

function parseShortText(content = "") {
  const escaped = escapeHtml(content.trim());
  if (!escaped) return "";
  const lines = escaped.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line));
  if (bulletLines.length && bulletLines.length === lines.length) {
    return `<ul>${bulletLines.map((line) => `<li>${line.replace(/^[-*]\s+/, "")}</li>`).join("")}</ul>`;
  }
  return escaped.replaceAll("\n", "<br>");
}

async function fetchPosts() {
  const snapshot = await getDocs(query(collection(db, "posts"), orderBy("date", "desc")));
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

async function fetchRankings() {
  const snapshot = await getDocs(query(collection(db, "rankings"), orderBy("rank", "asc")));
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

function renderPostCards(posts, options = {}) {
  const grid = $("#posts-grid");
  const empty = $("#posts-empty");
  const pagination = $("#pagination");
  const template = $("#post-card-template");
  const isExpanded = options.expanded ?? areRecentPostsExpanded;
  const visiblePosts = isExpanded ? posts : posts.slice(0, RECENT_POSTS_COLLAPSED_COUNT);

  grid.innerHTML = "";
  pagination.innerHTML = "";
  empty.classList.toggle("hidden", posts.length > 0);

  visiblePosts.forEach((post, index) => {
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector(".post-card");
    const link = clone.querySelector("a");
    const img = clone.querySelector("img");
    const tags = clone.querySelector(".tag-row");
    const action = clone.querySelector(".read-chip");
    if (post.kind === "recommendation") card.classList.add("recommendation-post-card");
    if (isExpanded && index === 0 && posts.length > 1 && post.kind !== "recommendation") {
      card.classList.add("featured-post-card");
    }
    link.href = post.href || `index.html?post=${post.id}-${slugify(post.title)}`;
    img.src = post.imageUrl;
    img.alt = post.title;
    clone.querySelector(".category-badge").textContent = post.category || "Anime";
    clone.querySelector("time").textContent = formatDate(post.date);
    clone.querySelector("h3").textContent = post.title;
    clone.querySelector("p").textContent = excerpt(post.content);
    if (action) action.textContent = post.kind === "recommendation" ? "Open list" : "Read";
    normalizeTags(post.tags).slice(0, 3).forEach((tag) => {
      const item = document.createElement("span");
      item.textContent = tag;
      tags.append(item);
    });
    grid.append(clone);
  });

  if (posts.length > RECENT_POSTS_COLLAPSED_COUNT) {
    const hiddenCount = posts.length - RECENT_POSTS_COLLAPSED_COUNT;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = isExpanded ? "Show fewer posts" : `Show ${hiddenCount} more post${hiddenCount === 1 ? "" : "s"}`;
    button.setAttribute("aria-controls", "posts-grid");
    button.setAttribute("aria-expanded", String(isExpanded));
    button.addEventListener("click", () => {
      areRecentPostsExpanded = !isExpanded;
      renderPostCards(posts, { expanded: areRecentPostsExpanded });
      if (!areRecentPostsExpanded) {
        grid.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    });
    pagination.append(button);
  }
}

function populatePostCategoryFilter(posts) {
  const filter = $("#post-category-filter");
  if (!filter) return;
  const current = filter.value;
  const categories = [...new Set(posts.map((post) => post.category).filter(Boolean))].sort();
  filter.innerHTML = '<option value="all">All categories</option>';
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    filter.append(option);
  });
  filter.value = categories.includes(current) ? current : "all";
}

function applyPostFilters() {
  const search = ($("#post-search")?.value || "").trim().toLowerCase();
  const category = $("#post-category-filter")?.value || "all";
  const filtered = homePosts.filter((post) => {
    const searchable = [
      post.title,
      post.category,
      post.content,
      normalizeTags(post.tags).join(" ")
    ].join(" ").toLowerCase();
    const matchesSearch = !search || searchable.includes(search);
    const matchesCategory = category === "all" || post.category === category;
    return matchesSearch && matchesCategory;
  });
  areRecentPostsExpanded = false;
  renderPostCards(filtered);
}

function setupPostFilters(posts) {
  homePosts = posts;
  populatePostCategoryFilter(posts);
  $("#post-search")?.addEventListener("input", applyPostFilters);
  $("#post-category-filter")?.addEventListener("change", applyPostFilters);
  applyPostFilters();
}

function readJikanCache(category, options = {}) {
  try {
    const raw = localStorage.getItem(`anime-radar:${category}`);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!options.allowStale && Date.now() - cached.createdAt > JIKAN_CACHE_TTL) return null;
    return cached.items;
  } catch {
    return null;
  }
}

function writeJikanCache(category, items) {
  try {
    localStorage.setItem(`anime-radar:${category}`, JSON.stringify({
      createdAt: Date.now(),
      items
    }));
  } catch {
    // Storage can be unavailable in private browsing; the radar still works without cache.
  }
}

async function fetchAnimeRadar(category) {
  const cached = readJikanCache(category);
  if (cached) return cached;

  try {
    const response = await fetch(`/.netlify/functions/anime-radar?category=${encodeURIComponent(category)}`);
    if (!response.ok) throw new Error(`Anime radar proxy failed: ${response.status}`);
    const payload = await response.json();
    const items = Array.isArray(payload.data) ? payload.data : [];
    writeJikanCache(category, items);
    return items;
  } catch (error) {
    const stale = readJikanCache(category, { allowStale: true });
    if (stale) return stale;
    throw error;
  }
}

function renderAnimeRadarCards(items = []) {
  const list = $("#anime-radar-list");
  const empty = $("#anime-radar-empty");
  const template = $("#anime-radar-template");
  if (!list || !template) return;

  list.innerHTML = "";
  empty?.classList.toggle("hidden", items.length > 0);
  items.forEach((anime) => {
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector(".anime-radar-card");
    const image = clone.querySelector("img");
    const score = clone.querySelector(".anime-radar-score");
    const details = [
      anime.type,
      anime.episodes ? `${anime.episodes} eps` : anime.status,
      anime.year
    ].filter(Boolean).slice(0, 2).join(" · ");

    card.href = anime.url;
    image.src = anime.imageUrl || "assets/regressed-ranker-hero.jpg";
    image.alt = `${anime.title} cover art`;
    score.textContent = anime.score ? `★ ${Number(anime.score).toFixed(1)}` : "New";
    clone.querySelector("h3").textContent = anime.title;
    clone.querySelector("p").textContent = details || "Anime";
    list.append(clone);
  });
}

async function loadAnimeRadar(category = "popular") {
  const list = $("#anime-radar-list");
  const empty = $("#anime-radar-empty");
  if (!list) return;

  list.setAttribute("aria-busy", "true");
  empty?.classList.add("hidden");
  try {
    renderAnimeRadarCards(await fetchAnimeRadar(category));
  } catch (error) {
    console.error(error);
    list.innerHTML = "";
    empty?.classList.remove("hidden");
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

function initAnimeRadar() {
  const tabs = [...document.querySelectorAll(".radar-tab")];
  if (!tabs.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((item) => {
        const isActive = item === tab;
        item.classList.toggle("active", isActive);
        item.setAttribute("aria-selected", String(isActive));
      });
      loadAnimeRadar(tab.dataset.radarCategory || "popular");
    });
  });

  const activeTab = tabs.find((tab) => tab.classList.contains("active")) || tabs[0];
  loadAnimeRadar(activeTab.dataset.radarCategory || "popular");
}

async function renderPostView(postId) {
  const snap = await getDoc(doc(db, "posts", postId));
  const main = $("main");
  if (!snap.exists()) {
    main.innerHTML = '<section class="empty-state"><h3>Post not found</h3><p>This post may have moved or been deleted.</p></section>';
    return;
  }
  const post = { id: snap.id, ...snap.data() };
  main.innerHTML = `
    <article class="post-view">
      <a class="ghost-button" href="index.html">Back to posts</a>
      <h1>${escapeHtml(post.title)}</h1>
      <div class="post-meta">
        <time>${formatDate(post.date)}</time>
        <span class="genre-chip">${escapeHtml(post.category || "Anime")}</span>
      </div>
      <img src="${escapeHtml(post.imageUrl)}" alt="${escapeHtml(post.title)}">
      <div class="post-content">${parseMarkdown(post.content)}</div>
    </article>
  `;
}

async function initHome() {
  initAnimeRadar();
  if (!hasConfiguredFirebase()) {
    renderPostCards([]);
    return;
  }
  const params = new URLSearchParams(location.search);
  const postParam = params.get("post");
  if (postParam) {
    await renderPostView(postParam.split("-")[0]);
    return;
  }
  try {
    const [posts, rankings] = await Promise.all([fetchPosts(), fetchRankings().catch(() => [])]);
    setupPostFilters(sortFeedItems([...posts, ...buildRecommendationLists(rankings)]));
  } catch (error) {
    console.error(error);
  }
}

async function initArchive() {
  const archive = $("#archive-list");
  const empty = $("#archive-empty");
  if (!hasConfiguredFirebase()) {
    archive.innerHTML = "";
    empty.classList.remove("hidden");
    empty.querySelector("p").textContent = "Add your Firebase config and published posts will appear here.";
    return;
  }
  const [posts, rankings] = await Promise.all([fetchPosts(), fetchRankings().catch(() => [])]);
  const archiveItems = sortFeedItems([...posts, ...buildRecommendationLists(rankings)]);
  empty.classList.toggle("hidden", archiveItems.length > 0);
  archive.innerHTML = "";

  const groups = archiveItems.reduce((result, post) => {
    const key = formatMonth(post.date);
    result[key] = result[key] || [];
    result[key].push(post);
    return result;
  }, {});

  Object.entries(groups).forEach(([month, monthPosts]) => {
    const section = document.createElement("section");
    section.className = "archive-group reveal-card";
    section.innerHTML = `<h2>${month}</h2><ul></ul>`;
    const list = section.querySelector("ul");
    monthPosts.forEach((post) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <a href="${escapeHtml(post.href || `index.html?post=${post.id}-${slugify(post.title)}`)}">
          <strong>${escapeHtml(post.title)}</strong>
        </a>
      `;
      list.append(li);
    });
    archive.append(section);
  });
}

function renderRankings(rankings, openTopic = "", search = "") {
  const list = $("#rankings-list");
  const empty = $("#rankings-empty");
  const template = $("#ranking-template");
  const term = search.trim().toLowerCase();
  const filtered = rankings.filter((item) => {
    const topicTitle = getRecommendationTopic(item);
    const searchable = [item.title, topicTitle, item.genre, item.description].join(" ").toLowerCase();
    const matchesSearch = !term || searchable.includes(term);
    return matchesSearch;
  });

  list.innerHTML = "";
  empty.classList.toggle("hidden", filtered.length > 0);

  const groups = groupRankingsByTopic(filtered);

  sortRecommendationGroupEntries(Object.entries(groups)).forEach(([groupTitle, items]) => {
    const sortedItems = sortRecommendations(items);
    const summaryTitles = sortedItems.slice(0, 2).map((item) => item.title).filter(Boolean);
    const summaryText = summaryTitles.length
      ? `Top picks: ${summaryTitles.join(", ")}${sortedItems.length > summaryTitles.length ? ` and ${sortedItems.length - summaryTitles.length} more` : ""}`
      : "Open the list to view the full recommendations.";
    const group = document.createElement("section");
    group.className = "recommendation-group reveal-card";
    group.innerHTML = `
      <header class="recommendation-group-title">
        <div>
          <h2>${escapeHtml(groupTitle)}</h2>
          <p class="recommendation-group-summary">${escapeHtml(summaryText)}</p>
        </div>
        <div class="recommendation-group-meta">
          <span>${sortedItems.length} pick${sortedItems.length === 1 ? "" : "s"}</span>
          <button class="recommendation-group-toggle" type="button" aria-expanded="false">Open list</button>
        </div>
      </header>
      <div class="recommendation-group-items hidden"></div>
    `;
    const groupItems = group.querySelector(".recommendation-group-items");
    const toggle = group.querySelector(".recommendation-group-toggle");

    const setExpanded = (expanded) => {
      group.classList.toggle("is-expanded", expanded);
      groupItems.classList.toggle("hidden", !expanded);
      toggle.textContent = expanded ? "Close list" : "Open list";
      toggle.setAttribute("aria-expanded", String(expanded));
    };

    toggle.addEventListener("click", () => setExpanded(groupItems.classList.contains("hidden")));

    sortedItems.forEach((item) => {
      const clone = template.content.cloneNode(true);
      const row = clone.querySelector(".ranking-row");
      const rank = getRankValue(item);
      const rating = getRatingValue(item);
      const rankNumber = clone.querySelector(".rank-number");
      if (rankNumber) rankNumber.textContent = rank === Number.MAX_SAFE_INTEGER ? "#" : `#${rank}`;
      clone.querySelector(".ranking-image").src = item.imageUrl || "assets/regressed-ranker-hero.jpg";
      clone.querySelector(".ranking-image").alt = item.title || "Recommendation artwork";
      clone.querySelector("h3").textContent = item.title || "Untitled recommendation";
      const label = getRecommendationLabel(item);
      const chip = clone.querySelector(".genre-chip");
      if (label && label !== groupTitle && label.length < 28) {
        chip.textContent = label;
      } else {
        chip.remove();
      }
      clone.querySelector(".recommendation-description").innerHTML = parseShortText(item.description);
      clone.querySelector(".rating-track span").style.width = `${rating * 10}%`;
      clone.querySelector(".rating-value").textContent = `${rating.toFixed(1)}/10`;
      row.setAttribute("aria-label", `${item.title || "Untitled"} recommendation`);
      groupItems.append(clone);
    });

    if (openTopic && groupTitle === openTopic) setExpanded(true);

    list.append(group);
  });
}

async function initRankings() {
  const search = $("#recommendation-search");
  const params = new URLSearchParams(location.search);
  const requestedTopic = params.get("topic");
  if (!hasConfiguredFirebase()) {
    $("#rankings-empty").classList.remove("hidden");
    $("#rankings-empty p").textContent = "Add your Firebase config and saved rankings will appear here.";
    return;
  }
  currentRankings = await fetchRankings();
  const updateRankings = () => renderRankings(currentRankings, requestedTopic || "", search?.value || "");

  updateRankings();
  search?.addEventListener("input", updateRankings);

  onSnapshot(query(collection(db, "rankings"), orderBy("rank", "asc")), (snapshot) => {
    currentRankings = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    updateRankings();
  });
}

function wireAdminAuth() {
  const loginForm = $("#login-form");
  const logoutButton = $("#logout-button");
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#login-button");
    setLoading(button, "Signing in...", true);
    try {
      await signInWithEmailAndPassword(auth, $("#login-email").value, $("#login-password").value);
      showMessage($("#login-message"), "");
    } catch (error) {
      console.error("Firebase sign-in failed:", error);
      showMessage($("#login-message"), authErrorMessage(error), true);
    } finally {
      setLoading(button, "Signing in...", false);
    }
  });

  logoutButton.addEventListener("click", () => signOut(auth));
  onAuthStateChanged(auth, (user) => {
    const allowedUser = Boolean(user) && (!adminUid || user.uid === adminUid);
    if (user && !allowedUser) {
      signOut(auth);
      showMessage($("#login-message"), "This account is not allowed to manage this site.", true);
      return;
    }
    $("#login-panel").classList.toggle("hidden", allowedUser);
    $("#admin-dashboard").classList.toggle("hidden", !allowedUser);
    logoutButton.classList.toggle("hidden", !allowedUser);
    if (allowedUser) wireAdminData();
  });
}

function resetPostForm() {
  $("#post-form").reset();
  $("#post-id").value = "";
  $("#post-date").valueAsDate = new Date();
  $("#save-post-button").textContent = "Publish post";
}

function resetRankingForm(options = {}) {
  if (!$("#ranking-form")) return;
  const previousTopic = $("#ranking-topic").value;
  const previousType = $("#ranking-genre").value;
  const previousRank = Number($("#ranking-rank").value || 0);
  $("#ranking-form").reset();
  $("#ranking-id").value = "";
  if (options.keepList) {
    $("#ranking-topic").value = previousTopic;
    $("#ranking-genre").value = previousType;
    $("#ranking-rank").value = previousRank ? previousRank + 1 : "";
  }
  $("#save-ranking-button").textContent = "Save recommendation";
}

function getPostFormData() {
  return {
    title: $("#post-title").value.trim(),
    imageUrl: $("#post-image").value.trim(),
    content: $("#post-content").value.trim(),
    date: $("#post-date").value,
    category: $("#post-category").value.trim(),
    tags: normalizeTags($("#post-tags").value),
    updatedAt: serverTimestamp()
  };
}

function getRankingFormData() {
  return {
    rank: Number($("#ranking-rank").value),
    title: $("#ranking-title").value.trim(),
    imageUrl: $("#ranking-image").value.trim(),
    description: $("#ranking-description").value.trim(),
    rating: Number($("#ranking-rating").value),
    topicTitle: $("#ranking-topic").value.trim(),
    genre: $("#ranking-genre").value.trim(),
    updatedAt: serverTimestamp()
  };
}

function fillPostForm(post) {
  $("#post-id").value = post.id;
  $("#post-title").value = post.title || "";
  $("#post-image").value = post.imageUrl || "";
  $("#post-content").value = post.content || "";
  $("#post-date").value = post.date || new Date().toISOString().slice(0, 10);
  $("#post-category").value = post.category || "";
  $("#post-tags").value = normalizeTags(post.tags).join(", ");
  $("#save-post-button").textContent = "Update post";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function fillRankingForm(item) {
  $("#ranking-id").value = item.id;
  $("#ranking-rank").value = item.rank || "";
  $("#ranking-title").value = item.title || "";
  $("#ranking-image").value = item.imageUrl || "";
  $("#ranking-description").value = item.description || "";
  $("#ranking-rating").value = item.rating || "";
  $("#ranking-topic").value = getRecommendationTopic(item);
  $("#ranking-genre").value = item.genre || "";
  $("#save-ranking-button").textContent = "Update recommendation";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAdminPosts(posts) {
  const list = $("#admin-posts-list");
  list.innerHTML = "";
  posts.forEach((post) => {
    const item = document.createElement("article");
    item.className = "admin-list-item";
    item.innerHTML = `
      <div>
        <h4>${escapeHtml(post.title)}</h4>
        <p>${formatDate(post.date)} // ${escapeHtml(post.category || "Anime")}</p>
      </div>
      <div class="item-actions">
        <button class="ghost-button edit" type="button">Edit</button>
        <button class="ghost-button danger-button delete" type="button">Delete</button>
      </div>
    `;
    item.querySelector(".edit").addEventListener("click", () => fillPostForm(post));
    item.querySelector(".delete").addEventListener("click", async () => {
      if (confirm(`Delete "${post.title}"?`)) await deleteDoc(doc(db, "posts", post.id));
    });
    list.append(item);
  });
}

function renderAdminRankings(rankings) {
  const list = $("#admin-rankings-list");
  list.innerHTML = "";
  const groups = rankings.reduce((result, ranking) => {
    const topic = getRecommendationTopic(ranking);
    result[topic] = result[topic] || [];
    result[topic].push(ranking);
    return result;
  }, {});

  Object.entries(groups).forEach(([topic, items]) => {
    const group = document.createElement("section");
    group.className = "admin-recommendation-group";
    group.innerHTML = `
      <header>
        <h3>${escapeHtml(topic)}</h3>
        <span>${items.length} item${items.length === 1 ? "" : "s"}</span>
      </header>
      <div class="admin-recommendation-items"></div>
    `;
    const groupItems = group.querySelector(".admin-recommendation-items");

    [...items].sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0)).forEach((ranking) => {
      const item = document.createElement("article");
      item.className = "admin-list-item admin-recommendation-item";
      item.innerHTML = `
        <img src="${escapeHtml(ranking.imageUrl || "")}" alt="${escapeHtml(ranking.title || "")}">
        <div>
          <h4>#${ranking.rank} ${escapeHtml(ranking.title)}</h4>
          <p>${escapeHtml(getRecommendationLabel(ranking))} · ${Number(ranking.rating || 0).toFixed(1)}/10</p>
        </div>
        <div class="item-actions">
          <button class="ghost-button edit" type="button">Edit</button>
          <button class="ghost-button danger-button delete" type="button">Delete</button>
        </div>
      `;
      item.querySelector(".edit").addEventListener("click", () => fillRankingForm(ranking));
      item.querySelector(".delete").addEventListener("click", async () => {
        if (confirm(`Delete "${ranking.title}"?`)) await deleteDoc(doc(db, "rankings", ranking.id));
      });
      groupItems.append(item);
    });

    list.append(group);
  });
}

function wireAdminData() {
  resetPostForm();
  $("#reset-post-form").onclick = resetPostForm;
  if ($("#reset-ranking-form")) $("#reset-ranking-form").onclick = resetRankingForm;
  setupImagePaste($("#post-image"), "posts", $("#post-message"));
  setupImagePaste($("#ranking-image"), "recommendations", $("#ranking-message"));

  $("#post-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("#save-post-button");
    let saved = false;
    setLoading(button, "Saving...", true);
    try {
      const id = $("#post-id").value;
      const data = getPostFormData();
      if (id) await setDoc(doc(db, "posts", id), data, { merge: true });
      else await addDoc(collection(db, "posts"), { ...data, createdAt: serverTimestamp() });
      showMessage($("#post-message"), "Post saved.");
      saved = true;
    } catch (error) {
      showMessage($("#post-message"), "Could not save the post. Check Firestore rules.", true);
    } finally {
      setLoading(button, "Saving...", false);
      if (saved) resetPostForm();
    }
  };

  if ($("#ranking-form")) {
    $("#ranking-form").onsubmit = async (event) => {
      event.preventDefault();
      const button = $("#save-ranking-button");
      let saved = false;
      setLoading(button, "Saving...", true);
      try {
        const id = $("#ranking-id").value;
        const data = getRankingFormData();
        const isEditing = Boolean(id);
        if (isEditing) await setDoc(doc(db, "rankings", id), data, { merge: true });
        else await addDoc(collection(db, "rankings"), { ...data, createdAt: serverTimestamp() });
        showMessage($("#ranking-message"), "Recommendation saved.");
        saved = true;
      } catch (error) {
        showMessage($("#ranking-message"), "Could not save the recommendation. Check Firestore rules.", true);
      } finally {
        setLoading(button, "Saving...", false);
        if (saved) resetRankingForm({ keepList: !$("#ranking-id").value });
      }
    };
  }

  onSnapshot(query(collection(db, "posts"), orderBy("date", "desc")), (snapshot) => {
    renderAdminPosts(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })));
  });
  if ($("#admin-rankings-list")) {
    onSnapshot(query(collection(db, "rankings"), orderBy("rank", "asc")), (snapshot) => {
      renderAdminRankings(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })));
    });
  }
  if ($("#ai-form")) wireAiDraft();
}

async function generateGeminiDraft(apiKey, topic) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${AI_REVIEW_PROMPT}\n\nTopic: ${topic}` }] }],
      generationConfig: { temperature: 0.82, maxOutputTokens: 520 }
    })
  });
  if (!response.ok) throw new Error("Gemini request failed");
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

async function generateOpenAiDraft(apiKey, topic) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: AI_REVIEW_PROMPT },
        { role: "user", content: `Topic: ${topic}` }
      ],
      temperature: 0.82,
      max_tokens: 520
    })
  });
  if (!response.ok) throw new Error("OpenAI request failed");
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

function wireAiDraft() {
  const provider = $("#ai-provider");
  const key = $("#ai-key");
  const savedProvider = localStorage.getItem("animeBlogAiProvider");
  provider.value = savedProvider || "gemini";
  key.value = localStorage.getItem(`animeBlogAiKey:${provider.value}`) || "";
  provider.onchange = () => {
    localStorage.setItem("animeBlogAiProvider", provider.value);
    key.value = localStorage.getItem(`animeBlogAiKey:${provider.value}`) || "";
  };
  key.oninput = () => localStorage.setItem(`animeBlogAiKey:${provider.value}`, key.value);

  $("#ai-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("#generate-button");
    const topic = $("#ai-topic").value.trim();
    if (!key.value.trim()) {
      showMessage($("#ai-message"), "Paste an API key first.", true);
      return;
    }
    setLoading(button, "Generating...", true);
    showMessage($("#ai-message"), "Drafting with feeling...");
    try {
      const draft = provider.value === "gemini"
        ? await generateGeminiDraft(key.value.trim(), topic)
        : await generateOpenAiDraft(key.value.trim(), topic);
      $("#draft-text").value = draft;
      $("#draft-panel").classList.remove("hidden");
      showMessage($("#ai-message"), "Draft ready. Edit anything before publishing.");
    } catch (error) {
      showMessage($("#ai-message"), "The draft request failed. Check your API key, provider, or browser console.", true);
    } finally {
      setLoading(button, "Generating...", false);
    }
  };

  $("#discard-draft-button").onclick = () => {
    $("#draft-text").value = "";
    $("#draft-panel").classList.add("hidden");
    showMessage($("#ai-message"), "Draft discarded.");
  };

  $("#publish-draft-button").onclick = async () => {
    const topic = $("#ai-topic").value.trim();
    const content = $("#draft-text").value.trim();
    if (!content) return;
    await addDoc(collection(db, "posts"), {
      title: topic,
      imageUrl: "https://images.unsplash.com/photo-1601850494422-3cf14624b0b3?auto=format&fit=crop&w=1200&q=80",
      content,
      date: new Date().toISOString().slice(0, 10),
      category: "Review",
      tags: normalizeTags(topic),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    $("#draft-panel").classList.add("hidden");
    $("#draft-text").value = "";
    showMessage($("#ai-message"), "Draft published as a blog post.");
  };
}

async function initAdmin() {
  if (!hasConfiguredFirebase()) {
    showMessage($("#login-message"), "Add your Firebase config before signing in.", true);
  }
  wireAdminAuth();
}

if (page === "home") initHome();
if (page === "rankings") initRankings().catch((error) => console.error(error));
if (page === "archive") initArchive().catch((error) => console.error(error));
if (page === "admin") initAdmin();

/*
One-time Firestore seed helper.
After Firebase is configured and you are signed in on the admin page, paste this function into the browser console,
then run seedDemoData(). Delete or ignore it afterward.

async function seedDemoData() {
  const samplePosts = [
    {
      title: "Why Attack on Titan Changed My Life",
      imageUrl: "https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1200&q=80",
      content: "Attack on Titan starts like a monster story and slowly turns into a mirror. That is rude. That is brilliant. Every season keeps asking what freedom costs, then refuses to blink when the answer gets ugly.",
      date: "2026-01-15",
      category: "Essay",
      tags: ["attack on titan", "dark fantasy", "essay"]
    },
    {
      title: "The Hidden Genius of Vinland Saga",
      imageUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
      content: "Vinland Saga is patient in a way most shows are afraid to be. It lets revenge burn itself out. Then it asks what kind of person is left standing in the smoke.",
      date: "2026-02-03",
      category: "Review",
      tags: ["vinland saga", "historical", "character"]
    },
    {
      title: "Frieren and the Art of Missing Someone",
      imageUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af2176?auto=format&fit=crop&w=1200&q=80",
      content: "Frieren is quiet, but it hits like a bell in an empty room. It understands that grief is not always dramatic. Sometimes it is just remembering too late.",
      date: "2026-03-11",
      category: "Reflection",
      tags: ["frieren", "fantasy", "emotion"]
    },
    {
      title: "Jujutsu Kaisen's Beautiful Chaos",
      imageUrl: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=1200&q=80",
      content: "Jujutsu Kaisen moves like it drank three coffees and learned ballet. The fights are loud, sure, but the real trick is how stylishly it lets dread creep into the room.",
      date: "2026-04-19",
      category: "Review",
      tags: ["jujutsu kaisen", "action", "shonen"]
    },
    {
      title: "Cowboy Bebop Still Has the Coolest Silence",
      imageUrl: "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?auto=format&fit=crop&w=1200&q=80",
      content: "Cowboy Bebop is cool because it knows when to shut up. The jazz, the space dust, the loneliness. It all lands because the show trusts the ache.",
      date: "2026-05-08",
      category: "Classic",
      tags: ["cowboy bebop", "classic", "sci-fi"]
    }
  ];

  const sampleRankings = [
    ["Attack on Titan", "Dark Fantasy", 9.8],
    ["Frieren: Beyond Journey's End", "Fantasy", 9.7],
    ["Vinland Saga", "Historical", 9.6],
    ["Jujutsu Kaisen", "Action", 9.3],
    ["Fullmetal Alchemist: Brotherhood", "Adventure", 9.5],
    ["Cowboy Bebop", "Sci-Fi", 9.4],
    ["Demon Slayer", "Action", 8.9],
    ["Chainsaw Man", "Dark Comedy", 9.0],
    ["Mob Psycho 100", "Supernatural", 9.2],
    ["Steins;Gate", "Sci-Fi", 9.4]
  ];

  for (const post of samplePosts) {
    await addDoc(collection(db, "posts"), { ...post, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }

  for (const [index, item] of sampleRankings.entries()) {
    const [title, genre, rating] = item;
    await addDoc(collection(db, "rankings"), {
      rank: index + 1,
      title,
      topicTitle: "Top Anime Rankings",
      genre,
      rating,
      imageUrl: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=900&q=80",
      description: `${title} earns its spot with unforgettable scenes, clean momentum, and the kind of emotional grip that ruins your sleep schedule.`,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
}
*/
