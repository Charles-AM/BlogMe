import { adminUid, firebaseConfig, netlifyBuildHookUrl } from "./firebase-config.js";
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
  getCountFromServer,
  onSnapshot,
  query,
  orderBy,
  limit as queryLimit,
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
const RECENT_POSTS_COLLAPSED_COUNT = 6;
const SIMPLE_LIST_MAX_ITEMS = 5;
const ANALYTICS_COLLECTION = "analyticsEvents";
const ANALYTICS_RECENT_LIMIT = 500;
const CHECK_THESE_OUT_ROTATE_COUNT = 5;
const CHECK_THESE_OUT_ROTATE_COUNT_MOBILE = 3;
const CHECK_THESE_OUT_ROTATE_MS = 300000;
let homePosts = [];
let currentRankings = [];
let areRecentPostsExpanded = false;
let checkTheseOutRotateIndex = 0;
let checkTheseOutTimer = null;
let checkTheseOutRecommendations = [];
let checkTheseOutLatestPosts = [];
const checkTheseOutDesktopMq = window.matchMedia("(min-width: 921px)");

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

function getRecommendationGroupId(topic = "") {
  return `recommendation-${slugify(topic) || "list"}`;
}

function getRecommendationListHref(topic = "") {
  const slug = slugify(topic) || "list";
  return `/recommendations/${encodeURIComponent(slug)}/`;
}

function listHref(post = {}) {
  const slug = slugify(post.title || post.id || "list") || slugify(post.id || "list");
  return `/lists/${encodeURIComponent(slug)}/`;
}

function excerpt(content = "", max = 150) {
  const plain = content.replace(/[#*_`>-]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max).trim()}...` : plain;
}

function normalizeAssetUrl(url = "", fallback = "/assets/regressed-ranker-hero.jpg") {
  const trimmed = String(url || "").trim();
  if (!trimmed) return fallback;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  return `/${trimmed.replace(/^\//, "")}`;
}

function postHref(post) {
  if (isSimpleListPost(post)) {
    return listHref(post);
  }
  return `/posts/${encodeURIComponent(String(post.id).toLowerCase())}/`;
}

function parsePostIdFromParam(postParam = "") {
  if (!postParam) return "";
  const decoded = decodeURIComponent(postParam);
  // Legacy links used `?post={id}-{slug}`; IDs do not include hyphens.
  const hyphenIndex = decoded.indexOf("-");
  return hyphenIndex === -1 ? decoded : decoded.slice(0, hyphenIndex);
}

function isSimpleListPost(post = {}) {
  return post.postType === "simple-list";
}

function normalizeListItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .slice(0, SIMPLE_LIST_MAX_ITEMS)
    .map((item) => ({
      imageUrl: String(item?.imageUrl || "").trim(),
      characterName: String(item?.characterName || item?.name || "").trim(),
      animeName: String(item?.animeName || item?.anime || "").trim()
    }))
    .filter((item) => item.imageUrl || item.characterName || item.animeName);
}

function previewItemList(items = [], limit = 2, fallback = "") {
  const names = items.filter(Boolean);
  if (!names.length) return fallback;
  const preview = names.slice(0, limit).join(", ");
  return names.length > limit ? `${preview}, ...` : preview;
}

function simpleListPreview(post = {}, limit = 2) {
  return previewItemList(
    normalizeListItems(post.listItems).map((item) => item.characterName),
    limit,
    "Character list"
  );
}

function postCardPreview(post = {}, limit = 2) {
  if (isSimpleListPost(post)) {
    return simpleListPreview(post, limit);
  }
  if (post.kind === "recommendation") {
    const titles = (post.items || []).map((item) => item.title).filter(Boolean);
    if (titles.length) {
      return previewItemList(titles, limit, "Recommendation list");
    }
    return previewItemList(
      String(post.content || "").split(",").map((part) => part.trim()).filter(Boolean),
      limit,
      "Recommendation list"
    );
  }
  const tags = normalizeTags(post.tags);
  if (tags.length) {
    return previewItemList(tags, limit, excerpt(post.content, 80));
  }
  return excerpt(post.content, 80);
}

function simpleListSearchText(post = {}) {
  return normalizeListItems(post.listItems)
    .map((item) => [item.characterName, item.animeName].join(" "))
    .join(" ");
}

function simpleListLede(items = []) {
  const count = normalizeListItems(items).length;
  return `${count} character${count === 1 ? "" : "s"}`;
}

function renderSimpleListItemsHtml(items = []) {
  return normalizeListItems(items).map((item, index) => `
    <article class="simple-list-entry">
      <span class="simple-list-rank">${String(index + 1).padStart(2, "0")}</span>
      <figure class="simple-list-media">
        <img src="${escapeHtml(normalizeAssetUrl(item.imageUrl))}" alt="${escapeHtml(item.characterName || "Character")}">
      </figure>
      <div class="simple-list-copy">
        <h2>${escapeHtml(item.characterName)}</h2>
        <p class="simple-list-anime">${escapeHtml(item.animeName)}</p>
      </div>
    </article>
  `).join("");
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
      imageUrl: normalizeAssetUrl(first.imageUrl || "assets/regressed-ranker-hero.jpg"),
      content: titles,
      date: getRecommendationDate(sortedItems),
      category: "Recommendations",
      tags: labels,
      items: sortedItems,
      href: getRecommendationListHref(topic)
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

function dateKey(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function monthKey(value = new Date()) {
  return dateKey(value).slice(0, 7);
}

function getStoredId(key) {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const next = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, next);
    return next;
  } catch {
    return "storage-unavailable";
  }
}

function getSessionId() {
  try {
    const key = "regressedRankerSessionId";
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const next = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(key, next);
    return next;
  } catch {
    return "session-unavailable";
  }
}

function getReferrerHost(referrer = "") {
  if (!referrer) return "Direct";
  try {
    return new URL(referrer).hostname.replace(/^www\./, "") || "Direct";
  } catch {
    return "Direct";
  }
}

function getDeviceType() {
  if (matchMedia("(max-width: 640px)").matches) return "mobile";
  if (matchMedia("(max-width: 920px)").matches) return "tablet";
  return "desktop";
}

function shouldTrackAnalytics() {
  const doNotTrack = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
  return hasConfiguredFirebase() && page !== "admin" && doNotTrack !== "1";
}

async function trackPageView(details = {}) {
  if (!shouldTrackAnalytics()) return;
  const now = new Date();
  try {
    await addDoc(collection(db, ANALYTICS_COLLECTION), {
      type: "page_view",
      page: page || "unknown",
      path: location.pathname || "/",
      query: location.search || "",
      pageUrl: `${location.pathname || "/"}${location.search || ""}`,
      title: details.title || document.title,
      contentType: details.contentType || page || "page",
      contentId: details.contentId || "",
      contentTitle: details.contentTitle || "",
      referrer: getReferrerHost(document.referrer),
      referrerUrl: document.referrer ? document.referrer.slice(0, 240) : "",
      visitorId: getStoredId("regressedRankerVisitorId"),
      sessionId: getSessionId(),
      device: getDeviceType(),
      language: navigator.language || "",
      dateKey: dateKey(now),
      monthKey: monthKey(now),
      createdAtClient: now.toISOString(),
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Analytics tracking skipped:", error?.code || error);
  }
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
    if (isSimpleListPost(post)) card.classList.add("simple-list-post-card");
    const listBadge = clone.querySelector(".list-only-badge");
    if (listBadge) listBadge.classList.toggle("hidden", !isSimpleListPost(post));
    if (isExpanded && index === 0 && posts.length > 1 && post.kind !== "recommendation") {
      card.classList.add("featured-post-card");
    }
    link.href = post.href || postHref(post);
    img.src = normalizeAssetUrl(post.imageUrl);
    img.alt = post.title;
    clone.querySelector(".category-badge").textContent = post.category || "Anime";
    clone.querySelector("time").textContent = formatDate(post.date);
    clone.querySelector("h3").textContent = post.title;
    clone.querySelector("p").textContent = postCardPreview(post);
    if (action) {
      action.textContent = post.kind === "recommendation"
        ? "Open list"
        : isSimpleListPost(post)
          ? "List only"
          : "Read";
    }
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
      isSimpleListPost(post) ? simpleListSearchText(post) : post.content,
      normalizeTags(post.tags).join(" ")
    ].join(" ").toLowerCase();
    const matchesSearch = !search || searchable.includes(search);
    const matchesCategory = category === "all" || post.category === category;
    return matchesSearch && matchesCategory;
  });
  areRecentPostsExpanded = false;
  renderPostCards(filtered);
}

function getCheckTheseOutPickCount() {
  return checkTheseOutDesktopMq.matches ? CHECK_THESE_OUT_ROTATE_COUNT : CHECK_THESE_OUT_ROTATE_COUNT_MOBILE;
}

function shouldRotateCheckTheseOut() {
  return checkTheseOutRecommendations.length > getCheckTheseOutPickCount();
}

function getLatestBlogPost(posts = []) {
  const blogPosts = posts.filter((post) => post.kind !== "recommendation");
  const articles = blogPosts.filter((post) => !isSimpleListPost(post));
  const pool = articles.length ? articles : blogPosts;
  return sortFeedItems(pool)[0] || null;
}

function getRotatingPicks(recommendations = [], startIndex = 0, count = CHECK_THESE_OUT_ROTATE_COUNT) {
  if (!recommendations.length) return [];
  const limit = Math.min(count, recommendations.length);
  const picks = [];
  for (let i = 0; i < limit; i++) {
    picks.push(recommendations[(startIndex + i) % recommendations.length]);
  }
  return picks;
}

function renderCheckFeaturedCardHtml(post) {
  const href = post.href || postHref(post);
  const action = isSimpleListPost(post) ? "List only" : "Read";
  return `
    <a class="check-featured-card reveal-card" href="${escapeHtml(href)}">
      <div class="check-featured-media">
        <img src="${escapeHtml(normalizeAssetUrl(post.imageUrl))}" alt="${escapeHtml(post.title)}">
        <span class="check-featured-badge">${escapeHtml(post.category || "Anime")}</span>
      </div>
      <div class="check-featured-copy">
        <p class="check-featured-label">Latest read</p>
        <h3>${escapeHtml(post.title)}</h3>
        <p>${escapeHtml(postCardPreview(post))}</p>
        <span class="read-chip">${action}</span>
      </div>
    </a>
  `.trim();
}

function renderCheckPickCardHtml(rec) {
  const href = rec.href || getRecommendationListHref(rec.title);
  return `
    <a class="check-pick-card reveal-card" href="${escapeHtml(href)}" data-check-pick>
      <img src="${escapeHtml(normalizeAssetUrl(rec.imageUrl))}" alt="">
      <div>
        <span class="check-pick-label">List</span>
        <h3>${escapeHtml(rec.title)}</h3>
        <p>${escapeHtml(postCardPreview(rec))}</p>
      </div>
    </a>
  `.trim();
}

function stopCheckTheseOutRotation() {
  if (checkTheseOutTimer) {
    clearInterval(checkTheseOutTimer);
    checkTheseOutTimer = null;
  }
}

function rotateCheckPicks() {
  const picksContainer = $("#check-picks");
  if (!picksContainer) return;

  const nextPicks = getRotatingPicks(checkTheseOutRecommendations, checkTheseOutRotateIndex, getCheckTheseOutPickCount());
  picksContainer.querySelectorAll(".check-pick-card").forEach((card) => {
    card.classList.add("is-rotating-out");
  });

  window.setTimeout(() => {
    picksContainer.innerHTML = nextPicks.map((rec) => renderCheckPickCardHtml(rec)).join("");
    picksContainer.querySelectorAll(".check-pick-card").forEach((card) => {
      card.classList.add("is-rotating-in");
      requestAnimationFrame(() => card.classList.remove("is-rotating-in"));
    });
  }, 280);
}

function refreshCheckPicks() {
  const picksContainer = $("#check-picks");
  if (!picksContainer) return;
  const nextPicks = getRotatingPicks(checkTheseOutRecommendations, checkTheseOutRotateIndex, getCheckTheseOutPickCount());
  picksContainer.innerHTML = nextPicks.map((rec) => renderCheckPickCardHtml(rec)).join("");
}

function wireCheckTheseOutResize() {
  if (wireCheckTheseOutResize.wired) return;
  wireCheckTheseOutResize.wired = true;
  checkTheseOutDesktopMq.addEventListener("change", () => {
    if (!checkTheseOutRecommendations.length) return;
    refreshCheckPicks();
    if (shouldRotateCheckTheseOut()) startCheckTheseOutRotation();
    else stopCheckTheseOutRotation();
  });
}

function startCheckTheseOutRotation() {
  stopCheckTheseOutRotation();
  if (!shouldRotateCheckTheseOut()) return;

  checkTheseOutTimer = window.setInterval(() => {
    checkTheseOutRotateIndex = (checkTheseOutRotateIndex + 1) % checkTheseOutRecommendations.length;
    rotateCheckPicks();
  }, CHECK_THESE_OUT_ROTATE_MS);
}

function renderCheckTheseOut(posts = [], rankings = [], options = {}) {
  const grid = $("#check-these-out-grid");
  const empty = $("#check-these-out-empty");
  if (!grid) return;

  const latest = getLatestBlogPost(posts);
  const recommendations = options.recommendations || buildRecommendationLists(rankings);
  checkTheseOutLatestPosts = posts;
  checkTheseOutRecommendations = recommendations;
  checkTheseOutRotateIndex = options.rotateIndex ?? checkTheseOutRotateIndex;
  wireCheckTheseOutResize();

  if (!latest && !recommendations.length) {
    grid.innerHTML = "";
    empty?.classList.remove("hidden");
    stopCheckTheseOutRotation();
    return;
  }

  empty?.classList.add("hidden");
  const picks = getRotatingPicks(recommendations, checkTheseOutRotateIndex, getCheckTheseOutPickCount());
  grid.innerHTML = `
    ${latest ? renderCheckFeaturedCardHtml(latest) : ""}
    ${picks.length ? `<div class="check-picks" id="check-picks">${picks.map((rec) => renderCheckPickCardHtml(rec)).join("")}</div>` : ""}
  `.trim();

  if (shouldRotateCheckTheseOut()) {
    startCheckTheseOutRotation();
  } else {
    stopCheckTheseOutRotation();
  }
}

function readPrerenderedCheckTheseOut() {
  const node = document.getElementById("check-these-out-data");
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent);
  } catch {
    return null;
  }
}

function initCheckTheseOutFromData(data) {
  if (!data) return;
  checkTheseOutRecommendations = data.recommendations || [];
  wireCheckTheseOutResize();
  if ($("#check-picks") && shouldRotateCheckTheseOut()) {
    startCheckTheseOutRotation();
  }
}

function setupPostFilters(posts) {
  homePosts = posts;
  populatePostCategoryFilter(posts);
  $("#post-search")?.addEventListener("input", applyPostFilters);
  $("#post-category-filter")?.addEventListener("change", applyPostFilters);
  applyPostFilters();
}

async function renderPostView(postId) {
  const snap = await getDoc(doc(db, "posts", postId));
  const main = $("main");
  if (!snap.exists()) {
    main.innerHTML = '<section class="empty-state"><h3>Post not found</h3><p>This post may have moved or been deleted.</p></section>';
    return;
  }
  const post = { id: snap.id, ...snap.data() };
  const backLink = '<a class="ghost-button" data-back-link href="index.html#posts-grid">Back to reads</a>';
  const meta = `
    <div class="post-meta">
      <time datetime="${escapeHtml(post.date || "")}">${formatDate(post.date)}</time>
      <span class="genre-chip">${escapeHtml(post.category || "Anime")}</span>
    </div>
  `;

  if (isSimpleListPost(post)) {
    const listBackLink = '<a class="post-back-link" data-back-link href="index.html#posts-grid">← Back to reads</a>';
    main.innerHTML = `
      <article class="post-view post-view-simple-list">
        <header class="simple-list-header">
          ${listBackLink}
          <p class="simple-list-eyebrow">List only</p>
          <h1>${escapeHtml(post.title)}</h1>
          ${meta}
          <p class="simple-list-lede">${escapeHtml(simpleListLede(post.listItems))}</p>
        </header>
        <div class="simple-list-stack" aria-label="Character list">
          ${renderSimpleListItemsHtml(post.listItems)}
        </div>
      </article>
    `;
  } else {
    main.innerHTML = `
      <article class="post-view">
        ${backLink}
        <h1>${escapeHtml(post.title)}</h1>
        ${meta}
        <img src="${escapeHtml(normalizeAssetUrl(post.imageUrl))}" alt="${escapeHtml(post.title)}">
        <div class="post-content">${parseMarkdown(post.content)}</div>
      </article>
    `;
  }
  main.querySelector("[data-back-link]")?.addEventListener("click", (event) => {
    try {
      const referrer = document.referrer ? new URL(document.referrer) : null;
      if (referrer?.origin === location.origin && history.length > 1) {
        event.preventDefault();
        history.back();
      }
    } catch {
      // Fall back to the href when the browser does not expose a same-site referrer.
    }
  });
  trackPageView({
    contentType: "post",
    contentId: post.id,
    contentTitle: post.title,
    title: `${post.title} | Regressed Ranker`
  });
}

function readPrerenderedFeed() {
  const node = document.getElementById("posts-feed-data");
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent);
  } catch {
    return null;
  }
}

function wirePrerenderedPagination() {
  const button = $("#pagination")?.querySelector("button");
  const grid = $("#posts-grid");
  if (!button || !grid) return;

  button.addEventListener("click", () => {
    areRecentPostsExpanded = !areRecentPostsExpanded;
    const cards = [...grid.querySelectorAll(".post-card")];
    cards.forEach((card, index) => {
      if (index >= RECENT_POSTS_COLLAPSED_COUNT) {
        card.classList.toggle("hidden", !areRecentPostsExpanded);
      }
    });
    filterPrerenderedCards();
    const hiddenCount = cards.length - RECENT_POSTS_COLLAPSED_COUNT;
    button.textContent = areRecentPostsExpanded
      ? "Show fewer posts"
      : `Show ${hiddenCount} more post${hiddenCount === 1 ? "" : "s"}`;
    button.setAttribute("aria-expanded", String(areRecentPostsExpanded));
    if (!areRecentPostsExpanded) {
      grid.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  });
}

function filterPrerenderedCards() {
  const search = ($("#post-search")?.value || "").trim().toLowerCase();
  const category = $("#post-category-filter")?.value || "all";
  const hasActiveFilter = Boolean(search) || category !== "all";
  const cards = [...$("#posts-grid")?.querySelectorAll(".post-card") || []];

  cards.forEach((card, index) => {
    const badge = card.querySelector(".category-badge")?.textContent?.trim() || "";
    const text = card.textContent?.toLowerCase() || "";
    const matchesSearch = !search || text.includes(search);
    const matchesCategory = category === "all" || badge === category;
    const visible = matchesSearch && matchesCategory;

    card.classList.toggle("filter-hidden", !visible);

    if (!visible) return;

    if (hasActiveFilter) {
      card.classList.remove("hidden");
      return;
    }

    if (!areRecentPostsExpanded && index >= RECENT_POSTS_COLLAPSED_COUNT) {
      card.classList.add("hidden");
    } else {
      card.classList.remove("hidden");
    }
  });
}

function initPrerenderedHome(feed) {
  homePosts = feed;
  populatePostCategoryFilter(feed);
  $("#post-search")?.addEventListener("input", filterPrerenderedCards);
  $("#post-category-filter")?.addEventListener("change", filterPrerenderedCards);
  wirePrerenderedPagination();
  initCheckTheseOutFromData(readPrerenderedCheckTheseOut());
  trackPageView({ contentType: "home", contentTitle: "Home" });
}

function initStaticRecommendationTopic() {
  trackPageView({
    contentType: "recommendation_topic",
    contentTitle: document.querySelector("main h1")?.textContent || document.title,
    title: document.title
  });
}

function initStaticCategoryPage() {
  trackPageView({
    contentType: "category",
    contentTitle: document.querySelector("main h1")?.textContent || document.title,
    title: document.title
  });
}

function initStaticPostPage() {
  const parts = location.pathname.split("/").filter(Boolean);
  const postId = parts[0] === "posts" ? parts[1] : "";
  const title = document.querySelector("main h1")?.textContent || document.title;

  $("main")?.querySelector("[data-back-link]")?.addEventListener("click", (event) => {
    try {
      const referrer = document.referrer ? new URL(document.referrer) : null;
      if (referrer?.origin === location.origin && history.length > 1) {
        event.preventDefault();
        history.back();
      }
    } catch {
      // Fall back to the href when the browser does not expose a same-site referrer.
    }
  });

  trackPageView({
    contentType: "post",
    contentId: postId,
    contentTitle: title,
    title: document.title
  });
}

async function initHome() {
  if (!hasConfiguredFirebase()) {
    renderPostCards([]);
    renderCheckTheseOut([], []);
    return;
  }
  const params = new URLSearchParams(location.search);
  const postParam = params.get("post");
  if (postParam) {
    $("main").innerHTML = '<section class="empty-state post-loading"><p>Loading post...</p></section>';
    await renderPostView(parsePostIdFromParam(postParam));
    return;
  }

  const prerenderedFeed = readPrerenderedFeed();
  const hasPrerenderedCards = Boolean($("#posts-grid")?.querySelector(".post-card"));
  if (prerenderedFeed?.length && hasPrerenderedCards) {
    initPrerenderedHome(prerenderedFeed);
    return;
  }

  try {
    const [posts, rankings] = await Promise.all([fetchPosts(), fetchRankings().catch(() => [])]);
    currentRankings = rankings;
    renderCheckTheseOut(posts, rankings);
    const allItems = sortFeedItems([...posts, ...buildRecommendationLists(rankings)]);
    setupPostFilters(allItems);
    trackPageView({ contentType: "home", contentTitle: "Home" });
  } catch (error) {
    console.error(error);
  }
}

async function initArchive() {
  const archive = $("#archive-list");
  const empty = $("#archive-empty");
  if (archive?.querySelector(".archive-group")) {
    trackPageView({ contentType: "archive", contentTitle: "Archive" });
    return;
  }
  if (!hasConfiguredFirebase()) {
    archive.innerHTML = "";
    empty.classList.remove("hidden");
    empty.querySelector("p").textContent = "Add your Firebase config and published posts will appear here.";
    return;
  }
  const [posts, rankings] = await Promise.all([fetchPosts(), fetchRankings().catch(() => [])]);
  const archiveItems = sortFeedItems([...posts, ...buildRecommendationLists(rankings)]);
  trackPageView({ contentType: "archive", contentTitle: "Archive" });
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
        <a href="${escapeHtml(post.href || postHref(post))}">
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
  let targetGroup = null;
  const filtered = rankings.filter((item) => {
    const topicTitle = getRecommendationTopic(item);
    const searchable = [item.title, topicTitle, item.genre, item.description].join(" ").toLowerCase();
    const matchesSearch = !term || searchable.includes(term);
    return matchesSearch;
  });

  list.innerHTML = "";
  empty.classList.toggle("hidden", filtered.length > 0);

  const groups = groupRankingsByTopic(filtered);

  const collapseOtherGroups = (currentGroup) => {
    list.querySelectorAll(".recommendation-group.is-expanded").forEach((openGroup) => {
      if (openGroup === currentGroup) return;
      openGroup.classList.remove("is-expanded");
      openGroup.querySelector(".recommendation-group-items")?.classList.add("hidden");
      const openToggle = openGroup.querySelector(".recommendation-group-toggle");
      if (openToggle) {
        openToggle.textContent = "Open list";
        openToggle.setAttribute("aria-expanded", "false");
      }
      openGroup.querySelector(".recommendation-back-link")?.classList.add("hidden");
    });
  };

  sortRecommendationGroupEntries(Object.entries(groups)).forEach(([groupTitle, items]) => {
    const sortedItems = sortRecommendations(items);
    const groupId = getRecommendationGroupId(groupTitle);
    const summaryTitles = sortedItems.slice(0, 2).map((item) => item.title).filter(Boolean);
    const summaryText = summaryTitles.length
      ? `Top picks: ${summaryTitles.join(", ")}${sortedItems.length > summaryTitles.length ? ` and ${sortedItems.length - summaryTitles.length} more` : ""}`
      : "Open the list to view the full recommendations.";
    const group = document.createElement("section");
    group.className = "recommendation-group reveal-card";
    group.id = groupId;
    group.tabIndex = -1;
    group.innerHTML = `
      <header class="recommendation-group-title">
        <div>
          <h2><a href="${escapeHtml(getRecommendationListHref(groupTitle))}">${escapeHtml(groupTitle)}</a></h2>
          <p class="recommendation-group-summary">${escapeHtml(summaryText)}</p>
        </div>
        <div class="recommendation-group-meta">
          <span>${sortedItems.length} pick${sortedItems.length === 1 ? "" : "s"}</span>
          <a class="recommendation-open-link" href="${escapeHtml(getRecommendationListHref(groupTitle))}">View list</a>
          <button class="recommendation-group-toggle" type="button" aria-expanded="false">Quick preview</button>
          <a class="recommendation-back-link hidden" href="recommendations.html">Back to all lists</a>
        </div>
      </header>
      <div class="recommendation-group-items hidden"></div>
    `;
    const groupItems = group.querySelector(".recommendation-group-items");
    const toggle = group.querySelector(".recommendation-group-toggle");
    const backLink = group.querySelector(".recommendation-back-link");

    const scrollToGroup = () => {
      group.scrollIntoView({ block: "start", behavior: "smooth" });
      group.focus({ preventScroll: true });
    };

    const setExpanded = (expanded, options = {}) => {
      if (expanded) collapseOtherGroups(group);
      group.classList.toggle("is-expanded", expanded);
      groupItems.classList.toggle("hidden", !expanded);
      toggle.textContent = expanded ? "Hide preview" : "Quick preview";
      toggle.setAttribute("aria-expanded", String(expanded));
      backLink.classList.toggle("hidden", !expanded);
      if (options.updateUrl) {
        history.pushState({}, "", expanded ? getRecommendationListHref(groupTitle) : "recommendations.html");
      }
      if (options.scroll) scrollToGroup();
    };

    toggle.addEventListener("click", () => {
      setExpanded(groupItems.classList.contains("hidden"), { scroll: true, updateUrl: true });
    });
    backLink.addEventListener("click", (event) => {
      event.preventDefault();
      setExpanded(false, { scroll: true, updateUrl: true });
    });

    sortedItems.forEach((item) => {
      const clone = template.content.cloneNode(true);
      const row = clone.querySelector(".ranking-row");
      const rank = getRankValue(item);
      const rating = getRatingValue(item);
      const rankNumber = clone.querySelector(".rank-number");
      if (rankNumber) rankNumber.textContent = rank === Number.MAX_SAFE_INTEGER ? "#" : `#${rank}`;
      clone.querySelector(".ranking-image").src = normalizeAssetUrl(item.imageUrl);
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

    if (openTopic && groupTitle === openTopic) {
      setExpanded(true);
      targetGroup = group;
    }

    list.append(group);
  });

  return targetGroup;
}

function readPrerenderedRankings() {
  const node = document.getElementById("rankings-feed-data");
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent);
  } catch {
    return null;
  }
}

function wirePrerenderedRecommendationGroups(openTopic = "") {
  const list = $("#rankings-list");
  if (!list) return null;

  const groups = [...list.querySelectorAll(".recommendation-group")];
  let targetGroup = null;

  const collapseOtherGroups = (currentGroup) => {
    groups.forEach((openGroup) => {
      if (openGroup === currentGroup) return;
      openGroup.classList.remove("is-expanded");
      openGroup.querySelector(".recommendation-group-items")?.classList.add("hidden");
      const openToggle = openGroup.querySelector(".recommendation-group-toggle");
      if (openToggle) {
        openToggle.textContent = "Open list";
        openToggle.setAttribute("aria-expanded", "false");
      }
      openGroup.querySelector(".recommendation-back-link")?.classList.add("hidden");
    });
  };

  groups.forEach((group) => {
    const groupItems = group.querySelector(".recommendation-group-items");
    const toggle = group.querySelector(".recommendation-group-toggle");
    const backLink = group.querySelector(".recommendation-back-link");
    const groupTitle = group.querySelector("h2")?.textContent || "";

    const scrollToGroup = () => {
      group.scrollIntoView({ block: "start", behavior: "smooth" });
      group.focus({ preventScroll: true });
    };

    const setExpanded = (expanded, options = {}) => {
      if (expanded) collapseOtherGroups(group);
      group.classList.toggle("is-expanded", expanded);
      groupItems?.classList.toggle("hidden", !expanded);
      if (toggle) {
        toggle.textContent = expanded ? "Hide preview" : "Quick preview";
        toggle.setAttribute("aria-expanded", String(expanded));
      }
      backLink?.classList.toggle("hidden", !expanded);
      if (options.updateUrl) {
        history.pushState({}, "", expanded ? getRecommendationListHref(groupTitle) : "recommendations.html");
      }
      if (options.scroll) scrollToGroup();
    };

    toggle?.addEventListener("click", () => {
      setExpanded(groupItems?.classList.contains("hidden"), { scroll: true, updateUrl: true });
    });
    backLink?.addEventListener("click", (event) => {
      event.preventDefault();
      setExpanded(false, { scroll: true, updateUrl: true });
    });

    if (openTopic && groupTitle === openTopic) {
      setExpanded(true);
      targetGroup = group;
    }
  });

  return targetGroup;
}

function filterPrerenderedRecommendations() {
  const term = ($("#recommendation-search")?.value || "").trim().toLowerCase();
  $("#rankings-list")?.querySelectorAll(".recommendation-group").forEach((group) => {
    const text = group.textContent?.toLowerCase() || "";
    group.classList.toggle("filter-hidden", Boolean(term) && !text.includes(term));
  });
}

function initPrerenderedRecommendations(rankings, openTopic = "") {
  currentRankings = rankings;
  const search = $("#recommendation-search");
  let hasScrolledToRequestedTopic = false;
  const targetGroup = wirePrerenderedRecommendationGroups(openTopic);

  if (targetGroup && !hasScrolledToRequestedTopic && !(search?.value || "").trim()) {
    hasScrolledToRequestedTopic = true;
    requestAnimationFrame(() => {
      targetGroup.scrollIntoView({ block: "start", behavior: "smooth" });
      targetGroup.focus({ preventScroll: true });
    });
  }

  search?.addEventListener("input", filterPrerenderedRecommendations);
  trackPageView({
    contentType: openTopic ? "recommendation_topic" : "recommendations",
    contentTitle: openTopic || "Recommendations"
  });
}

async function initRankings() {
  const search = $("#recommendation-search");
  const params = new URLSearchParams(location.search);
  let requestedTopic = params.get("topic") || "";
  let hasScrolledToRequestedTopic = false;

  const prerenderedRankings = readPrerenderedRankings();
  const hasPrerenderedGroups = Boolean($("#rankings-list")?.querySelector(".recommendation-group"));
  if (prerenderedRankings?.length && hasPrerenderedGroups) {
    initPrerenderedRecommendations(prerenderedRankings, requestedTopic);
    window.addEventListener("popstate", () => {
      requestedTopic = new URLSearchParams(location.search).get("topic") || "";
      wirePrerenderedRecommendationGroups(requestedTopic);
      filterPrerenderedRecommendations();
    });
    return;
  }

  if (!hasConfiguredFirebase()) {
    $("#rankings-empty").classList.remove("hidden");
    $("#rankings-empty p").textContent = "Add your Firebase config and saved rankings will appear here.";
    return;
  }
  currentRankings = await fetchRankings();
  const updateRankings = () => {
    const targetGroup = renderRankings(currentRankings, requestedTopic || "", search?.value || "");
    if (targetGroup && !hasScrolledToRequestedTopic && !(search?.value || "").trim()) {
      hasScrolledToRequestedTopic = true;
      requestAnimationFrame(() => {
        targetGroup.scrollIntoView({ block: "start", behavior: "smooth" });
        targetGroup.focus({ preventScroll: true });
      });
    }
  };

  updateRankings();
  trackPageView({
    contentType: requestedTopic ? "recommendation_topic" : "recommendations",
    contentTitle: requestedTopic || "Recommendations"
  });
  search?.addEventListener("input", updateRankings);
  window.addEventListener("popstate", () => {
    requestedTopic = new URLSearchParams(location.search).get("topic") || "";
    hasScrolledToRequestedTopic = false;
    updateRankings();
  });

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
  $("#post-type").value = "article";
  $("#save-post-button").textContent = "Publish post";
  syncPostFormType();
  renderPostListFields([]);
}

function syncPostFormType() {
  const isList = $("#post-type")?.value === "simple-list";
  $("#post-article-fields")?.classList.toggle("hidden", isList);
  $("#post-list-fields")?.classList.toggle("hidden", !isList);
  const content = $("#post-content");
  if (content) content.required = !isList;
}

function renderPostListFields(items = []) {
  const container = $("#post-list-items");
  if (!container) return;
  const rows = normalizeListItems(items);
  while (rows.length < SIMPLE_LIST_MAX_ITEMS) {
    rows.push({ imageUrl: "", characterName: "", animeName: "" });
  }
  container.innerHTML = rows.slice(0, SIMPLE_LIST_MAX_ITEMS).map((item, index) => `
    <fieldset class="simple-list-editor-item">
      <legend>Character ${index + 1}</legend>
      <label>
        Image
        <input class="post-list-image" data-list-index="${index}" value="${escapeHtml(item.imageUrl)}" placeholder="Paste image, local file, or image URL">
      </label>
      <div class="form-row">
        <label>
          Character
          <input class="post-list-character" data-list-index="${index}" value="${escapeHtml(item.characterName)}" placeholder="Killua">
        </label>
        <label>
          Anime
          <input class="post-list-anime" data-list-index="${index}" value="${escapeHtml(item.animeName)}" placeholder="Hunter x Hunter">
        </label>
      </div>
    </fieldset>
  `).join("");
  container.querySelectorAll(".post-list-image").forEach((input) => {
    setupImagePaste(input, "posts", $("#post-message"));
  });
}

function readPostListItemsFromForm() {
  const container = $("#post-list-items");
  if (!container) return [];
  const items = [];
  for (let index = 0; index < SIMPLE_LIST_MAX_ITEMS; index += 1) {
    const imageUrl = container.querySelector(`.post-list-image[data-list-index="${index}"]`)?.value.trim() || "";
    const characterName = container.querySelector(`.post-list-character[data-list-index="${index}"]`)?.value.trim() || "";
    const animeName = container.querySelector(`.post-list-anime[data-list-index="${index}"]`)?.value.trim() || "";
    if (imageUrl || characterName || animeName) {
      items.push({ imageUrl, characterName, animeName });
    }
  }
  return items.slice(0, SIMPLE_LIST_MAX_ITEMS);
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
  const postType = $("#post-type")?.value === "simple-list" ? "simple-list" : "article";
  const base = {
    title: $("#post-title").value.trim(),
    imageUrl: $("#post-image").value.trim(),
    date: $("#post-date").value,
    category: $("#post-category").value.trim(),
    tags: normalizeTags($("#post-tags").value),
    postType,
    updatedAt: serverTimestamp()
  };

  if (postType === "simple-list") {
    const listItems = readPostListItemsFromForm();
    return {
      ...base,
      listItems,
      content: simpleListPreview({ listItems })
    };
  }

  return {
    ...base,
    postType: "article",
    content: $("#post-content").value.trim(),
    listItems: []
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
  $("#post-type").value = isSimpleListPost(post) ? "simple-list" : "article";
  $("#save-post-button").textContent = "Update post";
  syncPostFormType();
  renderPostListFields(post.listItems || []);
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
        <p>${formatDate(post.date)} // ${escapeHtml(post.category || "Anime")}${isSimpleListPost(post) ? " // Simple list" : ""}</p>
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

function setAnalyticsText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function formatDateTime(value) {
  return toDate(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function analyticsEventDate(event = {}) {
  return toDate(event.createdAt || event.createdAtClient);
}

function analyticsPageLabel(event = {}) {
  return event.contentTitle || event.pageUrl || event.path || "Unknown page";
}

function topAnalyticsEntries(events, getKey, limit = 5) {
  const counts = events.reduce((result, event) => {
    const key = getKey(event) || "Unknown";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function renderAnalyticsList(selector, entries, emptyText) {
  const list = $(selector);
  if (!list) return;
  list.innerHTML = "";
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "helper-text";
    empty.textContent = emptyText;
    list.append(empty);
    return;
  }
  entries.forEach(([label, count]) => {
    const item = document.createElement("article");
    item.className = "analytics-list-item";
    item.innerHTML = `
      <strong>${escapeHtml(label)}</strong>
      <span>${count} view${count === 1 ? "" : "s"}</span>
    `;
    list.append(item);
  });
}

function renderRecentAnalytics(events) {
  const list = $("#analytics-recent");
  if (!list) return;
  list.innerHTML = "";
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "helper-text";
    empty.textContent = "No page views have been recorded yet.";
    list.append(empty);
    return;
  }
  events.slice(0, 10).forEach((event) => {
    const item = document.createElement("article");
    item.className = "analytics-list-item";
    const referrer = event.referrer && event.referrer !== "Direct" ? `from ${event.referrer}` : "direct visit";
    item.innerHTML = `
      <strong>${escapeHtml(analyticsPageLabel(event))}</strong>
      <span>${escapeHtml(formatDateTime(event.createdAt || event.createdAtClient))} · ${escapeHtml(event.device || "device")} · ${escapeHtml(referrer)}</span>
    `;
    list.append(item);
  });
}

function renderAdminAnalytics(events, totalViews) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);
  const today = dateKey(now);
  const todayViews = events.filter((event) => event.dateKey === today).length;
  const weekViews = events.filter((event) => analyticsEventDate(event) >= weekStart).length;
  const recentVisitors = new Set(events.map((event) => event.visitorId).filter(Boolean)).size;

  setAnalyticsText("#analytics-today", todayViews.toLocaleString());
  setAnalyticsText("#analytics-week", weekViews.toLocaleString());
  setAnalyticsText("#analytics-total", Number(totalViews || events.length).toLocaleString());
  setAnalyticsText("#analytics-visitors", recentVisitors.toLocaleString());
  renderAnalyticsList("#analytics-top-pages", topAnalyticsEntries(events, analyticsPageLabel), "No top pages yet.");
  renderAnalyticsList("#analytics-referrers", topAnalyticsEntries(events, (event) => event.referrer || "Direct"), "No referrers yet.");
  renderRecentAnalytics(events);
}

async function loadAdminAnalytics() {
  if (!$("#analytics-message")) return;
  showMessage($("#analytics-message"), "Loading analytics...");
  try {
    const analyticsCollection = collection(db, ANALYTICS_COLLECTION);
    const [snapshot, countSnapshot] = await Promise.all([
      getDocs(query(analyticsCollection, orderBy("createdAt", "desc"), queryLimit(ANALYTICS_RECENT_LIMIT))),
      getCountFromServer(analyticsCollection)
    ]);
    const events = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    renderAdminAnalytics(events, countSnapshot.data().count);
    showMessage($("#analytics-message"), events.length ? `Showing latest ${events.length} tracked views.` : "No visits recorded yet.");
  } catch (error) {
    console.error("Analytics load failed:", error);
    showMessage($("#analytics-message"), "Could not load analytics. Check Firestore rules for analyticsEvents.", true);
  }
}

async function triggerSiteRebuild(messageNode = $("#rebuild-message")) {
  if (!netlifyBuildHookUrl) {
    showMessage(messageNode, "Build hook URL is not configured.", true);
    return false;
  }
  const button = $("#rebuild-site-button");
  setLoading(button, "Starting rebuild...", true);
  try {
    const response = await fetch(netlifyBuildHookUrl, { method: "POST", body: "{}" });
    if (!response.ok) throw new Error(`Rebuild request failed: ${response.status}`);
    showMessage(messageNode, "Rebuild started. Give Netlify 2–5 minutes, then refresh the homepage.");
    return true;
  } catch (error) {
    console.error(error);
    showMessage(messageNode, "Could not start rebuild. Open Netlify → Deploys → Trigger deploy.", true);
    return false;
  } finally {
    setLoading(button, "Starting rebuild...", false);
  }
}

function wireAdminData() {
  resetPostForm();
  $("#reset-post-form").onclick = resetPostForm;
  $("#post-type")?.addEventListener("change", syncPostFormType);
  if ($("#reset-ranking-form")) $("#reset-ranking-form").onclick = resetRankingForm;
  if ($("#refresh-analytics")) $("#refresh-analytics").onclick = loadAdminAnalytics;
  if ($("#rebuild-site-button")) $("#rebuild-site-button").onclick = () => triggerSiteRebuild();
  loadAdminAnalytics();
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
      if (data.postType === "simple-list") {
        const completeItems = normalizeListItems(data.listItems).filter(
          (item) => item.imageUrl && item.characterName && item.animeName
        );
        if (!completeItems.length) {
          showMessage($("#post-message"), "Add at least one character with image, name, and anime.", true);
          return;
        }
        data.listItems = completeItems;
        data.content = simpleListPreview({ listItems: completeItems });
      } else if (!data.content) {
        showMessage($("#post-message"), "Add post content before publishing.", true);
        return;
      }
      if (id) await setDoc(doc(db, "posts", id), data, { merge: true });
      else await addDoc(collection(db, "posts"), { ...data, createdAt: serverTimestamp() });
      showMessage($("#post-message"), "Post saved. Click Rebuild live site above to update the public HTML.");
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
        showMessage($("#ranking-message"), "Recommendation saved. Click Rebuild live site above to update the public HTML.");
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
if (page === "post" || page === "list") initStaticPostPage();
if (page === "recommendation-topic") initStaticRecommendationTopic();
if (page === "category") initStaticCategoryPage();
if (page === "rankings") initRankings().catch((error) => console.error(error));
if (page === "archive") initArchive().catch((error) => console.error(error));
if (page === "admin") initAdmin();
if (!page) {
  trackPageView({
    contentType: "page",
    contentTitle: document.title.split("|")[0].trim() || "Page"
  });
}

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
