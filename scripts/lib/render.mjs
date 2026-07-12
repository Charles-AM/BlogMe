const SITE_URL = "https://regressedranker.xyz";
const RECENT_POSTS_COLLAPSED_COUNT = 3;
const SIMPLE_LIST_MAX_ITEMS = 5;

export { SITE_URL, RECENT_POSTS_COLLAPSED_COUNT };

export function toDate(value) {
  if (!value) return new Date();
  if (typeof value.toDate === "function") return value.toDate();
  if (value.seconds != null) return new Date(value.seconds * 1000);
  return new Date(value);
}

export function formatDate(value) {
  return toDate(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function formatMonth(value) {
  return toDate(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long"
  });
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function slugify(value = "") {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function postCanonicalPath(post) {
  if (isSimpleListPost(post)) {
    return listCanonicalPath(post);
  }
  return `/posts/${encodeURIComponent(String(post.id).toLowerCase())}/`;
}

export function listCanonicalPath(post = {}) {
  return `/lists/${encodeURIComponent(resolvePostSlug(post))}/`;
}

export function resolvePostSlug(post = {}) {
  const base = slugify(post.title || post.id || "list");
  return base || slugify(post.id || "list");
}

export function recommendationTopicSlug(topic = "") {
  return slugify(topic) || "list";
}

export function recommendationTopicCanonicalPath(topic = "") {
  return `/recommendations/${encodeURIComponent(recommendationTopicSlug(topic))}/`;
}

export function categorySlug(category = "") {
  return slugify(category) || "posts";
}

export function categoryCanonicalPath(category = "") {
  return `/category/${encodeURIComponent(categorySlug(category))}/`;
}

export function postHref(post) {
  return postCanonicalPath(post);
}

export function excerpt(content = "", max = 150) {
  const plain = String(content).replace(/[#*_`>-]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max).trim()}...` : plain;
}

export function isSimpleListPost(post = {}) {
  return post.postType === "simple-list";
}

export function normalizeListItems(items = []) {
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

export function postCardPreview(post = {}, limit = 2) {
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

export function simpleListLede(items = []) {
  const count = normalizeListItems(items).length;
  return `${count} character${count === 1 ? "" : "s"} · image and name only`;
}

export function renderSimpleListItemsHtml(items = []) {
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

export function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags;
  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function parseMarkdown(content = "") {
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

export function postDescription(post = {}) {
  if (isSimpleListPost(post)) {
    const names = normalizeListItems(post.listItems).map((item) => item.characterName).filter(Boolean);
    const base = names.length
      ? `Character list: ${names.slice(0, 4).join(", ")}`
      : "A quick anime character list from Regressed Ranker.";
    return excerpt(base, 160);
  }
  if (post.kind === "recommendation") {
    return excerpt(post.content || post.title, 160);
  }
  return excerpt(post.content || post.title, 160);
}

export function normalizeAssetUrl(url = "", fallback = "/assets/regressed-ranker-hero.jpg") {
  const trimmed = String(url || "").trim();
  if (!trimmed) return fallback;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  return `/${trimmed.replace(/^\//, "")}`;
}

export function postOgImage(post = {}) {
  const image = String(post.imageUrl || "").trim();
  if (image.startsWith("http")) return image;
  const normalized = normalizeAssetUrl(image, "");
  if (normalized) return `${SITE_URL}${normalized}`;
  return `${SITE_URL}/assets/regressed-ranker-hero.jpg`;
}

export function isoDate(value) {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function renderMetaTags({
  title,
  description,
  canonicalPath,
  image,
  type = "article"
}) {
  const canonical = `${SITE_URL}${canonicalPath}`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImage = escapeHtml(image);
  const safeCanonical = escapeHtml(canonical);

  return `
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDescription}">
    <link rel="canonical" href="${safeCanonical}">
    <meta property="og:site_name" content="Regressed Ranker">
    <meta property="og:title" content="${safeTitle}">
    <meta property="og:description" content="${safeDescription}">
    <meta property="og:image" content="${safeImage}">
    <meta property="og:url" content="${safeCanonical}">
    <meta property="og:type" content="${type}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${safeTitle}">
    <meta name="twitter:description" content="${safeDescription}">
    <meta name="twitter:image" content="${safeImage}">
  `.trim();
}

export function renderPostCardHtml(post, index = 0, options = {}) {
  const href = post.href || postHref(post);
  const classes = ["post-card", "reveal-card"];
  if (post.kind === "recommendation") classes.push("recommendation-post-card");
  if (isSimpleListPost(post)) classes.push("simple-list-post-card");
  if (options.expanded && index === 0 && options.total > 1 && post.kind !== "recommendation") {
    classes.push("featured-post-card");
  }
  if (options.hidden) classes.push("hidden");

  const listBadgeHidden = isSimpleListPost(post) ? "" : " hidden";
  const action = post.kind === "recommendation"
    ? "Open list"
    : isSimpleListPost(post)
      ? "List only"
      : "Read";
  const tags = normalizeTags(post.tags).slice(0, 3)
    .map((tag) => `<span>${escapeHtml(tag)}</span>`)
    .join("");

  return `
    <article class="${classes.join(" ")}">
      <a class="post-card-link" href="${escapeHtml(href)}">
        <div class="image-wrap">
          <img alt="${escapeHtml(post.title)}" src="${escapeHtml(normalizeAssetUrl(post.imageUrl))}">
          <span class="category-badge">${escapeHtml(post.category || "Anime")}</span>
          <span class="list-only-badge${listBadgeHidden}">List only</span>
        </div>
        <div class="post-card-body">
          <time datetime="${escapeHtml(isoDate(post.date))}">${formatDate(post.date)}</time>
          <h3>${escapeHtml(post.title)}</h3>
          <p>${escapeHtml(postCardPreview(post))}</p>
          <div class="post-card-footer">
            <div class="tag-row">${tags}</div>
            <span class="read-chip">${action}</span>
          </div>
        </div>
      </a>
    </article>
  `.trim();
}

export function renderPostsGridHtml(posts = []) {
  const cards = posts.map((post, index) => renderPostCardHtml(post, index, {
    expanded: false,
    total: posts.length,
    hidden: index >= RECENT_POSTS_COLLAPSED_COUNT
  }));

  let pagination = "";
  if (posts.length > RECENT_POSTS_COLLAPSED_COUNT) {
    const hiddenCount = posts.length - RECENT_POSTS_COLLAPSED_COUNT;
    pagination = `<button type="button" aria-controls="posts-grid" aria-expanded="false">Show ${hiddenCount} more post${hiddenCount === 1 ? "" : "s"}</button>`;
  }

  return { cardsHtml: cards.join("\n"), paginationHtml: pagination };
}

export function renderArchiveHtml(items = []) {
  const groups = items.reduce((result, post) => {
    const key = formatMonth(post.date);
    result[key] = result[key] || [];
    result[key].push(post);
    return result;
  }, {});

  return Object.entries(groups).map(([month, monthPosts]) => {
    const links = monthPosts.map((post) => {
      const href = post.href || postHref(post);
      return `<li><a href="${escapeHtml(href)}"><strong>${escapeHtml(post.title)}</strong></a></li>`;
    }).join("\n");
    return `
      <section class="archive-group reveal-card">
        <h2>${escapeHtml(month)}</h2>
        <ul>
          ${links}
        </ul>
      </section>
    `.trim();
  }).join("\n");
}

export function renderPostBodyHtml(post) {
  const meta = `
    <div class="post-meta">
      <time datetime="${escapeHtml(isoDate(post.date))}">${formatDate(post.date)}</time>
      <span class="genre-chip">${escapeHtml(post.category || "Anime")}</span>
    </div>
  `;

  if (isSimpleListPost(post)) {
    const backLink = '<a class="post-back-link" data-back-link href="/index.html#posts-grid">← Back to reads</a>';
    return `
      <article class="post-view post-view-simple-list">
        <header class="simple-list-header">
          ${backLink}
          <p class="simple-list-eyebrow">List only</p>
          <h1>${escapeHtml(post.title)}</h1>
          ${meta}
          <p class="simple-list-lede">${escapeHtml(simpleListLede(post.listItems))}</p>
        </header>
        <div class="simple-list-stack" aria-label="Character list">
          ${renderSimpleListItemsHtml(post.listItems)}
        </div>
      </article>
    `.trim();
  }

  const backLink = '<a class="ghost-button" data-back-link href="/index.html#posts-grid">Back to reads</a>';
  return `
    <article class="post-view">
      ${backLink}
      <h1>${escapeHtml(post.title)}</h1>
      ${meta}
      <img src="${escapeHtml(normalizeAssetUrl(post.imageUrl))}" alt="${escapeHtml(post.title)}">
      <div class="post-content">${parseMarkdown(post.content || "")}</div>
    </article>
  `.trim();
}

export function getRecommendationGroupId(topic = "") {
  return `recommendation-${slugify(topic) || "list"}`;
}

export function getRecommendationListHref(topic = "") {
  return recommendationTopicCanonicalPath(topic);
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

export function buildRecommendationLists(rankings = []) {
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

export function sortFeedItems(items = []) {
  return [...items].sort((a, b) => toDate(b.date) - toDate(a.date));
}

export function serializeFeedForClient(items = []) {
  return items.map((post) => ({
    id: post.id,
    kind: post.kind || "post",
    postType: post.postType || "",
    title: post.title || "",
    imageUrl: post.imageUrl || "",
    content: post.content || "",
    date: isoDate(post.date),
    category: post.category || "",
    tags: normalizeTags(post.tags),
    listItems: post.listItems || [],
    href: post.href || postHref(post)
  }));
}

export function parseShortText(content = "") {
  const escaped = escapeHtml(String(content).trim());
  if (!escaped) return "";
  const lines = escaped.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line));
  if (bulletLines.length && bulletLines.length === lines.length) {
    return `<ul>${bulletLines.map((line) => `<li>${line.replace(/^[-*]\s+/, "")}</li>`).join("")}</ul>`;
  }
  return escaped.replaceAll("\n", "<br>");
}

export function recommendationTopicSitemapUrl(topic = "") {
  return `${SITE_URL}${recommendationTopicCanonicalPath(topic)}`;
}

export function listSitemapUrl(post = {}) {
  return `${SITE_URL}${listCanonicalPath(post)}`;
}

export function categorySitemapUrl(category = "") {
  return `${SITE_URL}${categoryCanonicalPath(category)}`;
}

export function recommendationListDescription(groupTitle, items = []) {
  const sorted = sortRecommendations(items);
  const titles = sorted.slice(0, 4).map((item) => item.title).filter(Boolean);
  const base = titles.length ? `${groupTitle}: ${titles.join(", ")}` : groupTitle;
  return excerpt(base, 160);
}

function renderRankingRowHtml(item, groupTitle) {
  const rating = getRatingValue(item);
  const label = getRecommendationLabel(item);
  const chip = label && label !== groupTitle && label.length < 28
    ? `<span class="genre-chip">${escapeHtml(label)}</span>`
    : "";

  return `
    <article class="ranking-row reveal-card" aria-label="${escapeHtml(item.title || "Untitled")} recommendation">
      <div class="ranking-media">
        <img class="ranking-image" alt="${escapeHtml(item.title || "Recommendation artwork")}" src="${escapeHtml(normalizeAssetUrl(item.imageUrl))}">
      </div>
      <div class="ranking-copy">
        <div class="ranking-title-line">
          <h3>${escapeHtml(item.title || "Untitled recommendation")}</h3>
          ${chip}
        </div>
        <div class="recommendation-description">${parseShortText(item.description || "")}</div>
        <div class="rating-track" aria-label="Rating out of 10">
          <span style="width: ${rating * 10}%"></span>
        </div>
      </div>
      <div class="ranking-actions">
        <strong class="rating-value">${rating.toFixed(1)}/10</strong>
      </div>
    </article>
  `.trim();
}

export function renderRecommendationTopicBodyHtml(topic, items = []) {
  const sortedItems = sortRecommendations(items);
  const summaryTitles = sortedItems.slice(0, 2).map((item) => item.title).filter(Boolean);
  const summaryText = summaryTitles.length
    ? `Top picks: ${summaryTitles.join(", ")}${sortedItems.length > summaryTitles.length ? ` and ${sortedItems.length - summaryTitles.length} more` : ""}`
    : "Ranked anime and manga recommendations.";
  const rows = sortedItems.map((item) => renderRankingRowHtml(item, topic)).join("\n");

  return `
    <article class="recommendation-topic-view">
      <header class="recommendation-topic-header">
        <a class="post-back-link" href="/recommendations.html">← All lists</a>
        <p class="eyebrow">Recommendations</p>
        <h1>${escapeHtml(topic)}</h1>
        <p class="recommendation-group-summary">${escapeHtml(summaryText)}</p>
        <p class="recommendation-topic-count">${sortedItems.length} pick${sortedItems.length === 1 ? "" : "s"}</p>
      </header>
      <div class="leaderboard recommendation-topic-list" aria-label="${escapeHtml(topic)} recommendations">
        ${rows}
      </div>
    </article>
  `.trim();
}

export function renderRecommendationsHubHtml(rankings = []) {
  const groups = groupRankingsByTopic(rankings);
  if (!rankings.length) return "";

  return sortRecommendationGroupEntries(Object.entries(groups)).map(([groupTitle, items]) => {
    const sortedItems = sortRecommendations(items);
    const groupId = getRecommendationGroupId(groupTitle);
    const topicHref = getRecommendationListHref(groupTitle);
    const summaryTitles = sortedItems.slice(0, 2).map((item) => item.title).filter(Boolean);
    const summaryText = summaryTitles.length
      ? `Top picks: ${summaryTitles.join(", ")}${sortedItems.length > summaryTitles.length ? ` and ${sortedItems.length - summaryTitles.length} more` : ""}`
      : "Open the list to view the full recommendations.";
    const rows = sortedItems.map((item) => renderRankingRowHtml(item, groupTitle)).join("\n");

    return `
      <section class="recommendation-group reveal-card" id="${escapeHtml(groupId)}" tabindex="-1">
        <header class="recommendation-group-title">
          <div>
            <h2><a href="${escapeHtml(topicHref)}">${escapeHtml(groupTitle)}</a></h2>
            <p class="recommendation-group-summary">${escapeHtml(summaryText)}</p>
          </div>
          <div class="recommendation-group-meta">
            <span>${sortedItems.length} pick${sortedItems.length === 1 ? "" : "s"}</span>
            <a class="recommendation-open-link" href="${escapeHtml(topicHref)}">View list</a>
            <button class="recommendation-group-toggle" type="button" aria-expanded="false">Quick preview</button>
          </div>
        </header>
        <div class="recommendation-group-items hidden">
          ${rows}
        </div>
      </section>
    `.trim();
  }).join("\n");
}

export function renderCategoryHubHtml(category, posts = []) {
  const cards = posts.map((post, index) => renderPostCardHtml(post, index, {
    expanded: true,
    total: posts.length,
    hidden: false
  })).join("\n");

  return `
    <section class="category-hub">
      <header class="page-hero simple-page-heading">
        <p class="eyebrow">Regressed Ranker</p>
        <h1>${escapeHtml(category)}</h1>
        <p>${posts.length} post${posts.length === 1 ? "" : "s"} in this section.</p>
      </header>
      <div class="blog-grid category-hub-grid" aria-label="${escapeHtml(category)} posts">
        ${cards}
      </div>
    </section>
  `.trim();
}

export function renderRecommendationsHtml(rankings = []) {
  return renderRecommendationsHubHtml(rankings);
}

export function getRecommendationTopics(rankings = []) {
  return sortRecommendationGroupEntries(Object.entries(groupRankingsByTopic(rankings))).map(([topic, items]) => ({
    topic,
    slug: recommendationTopicSlug(topic),
    items,
    lastmod: isoDate(getRecommendationDate(items)),
    description: recommendationListDescription(topic, items),
    canonicalPath: recommendationTopicCanonicalPath(topic),
    sitemapUrl: recommendationTopicSitemapUrl(topic),
    image: postOgImage({ imageUrl: sortRecommendations(items)[0]?.imageUrl })
  }));
}

export function getCategoryTopics(posts = []) {
  const groups = posts.reduce((result, post) => {
    const category = post.category || "Blog";
    result[category] = result[category] || [];
    result[category].push(post);
    return result;
  }, {});

  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, categoryPosts]) => ({
      category,
      slug: categorySlug(category),
      posts: sortFeedItems(categoryPosts),
      canonicalPath: categoryCanonicalPath(category),
      sitemapUrl: categorySitemapUrl(category),
      description: excerpt(
        `${category} posts from Regressed Ranker: ${sortFeedItems(categoryPosts).slice(0, 4).map((post) => post.title).join(", ")}`,
        160
      ),
      lastmod: isoDate(
        sortFeedItems(categoryPosts)[0]?.date || new Date()
      )
    }));
}

export function serializeRankingsForClient(rankings = []) {
  return rankings.map((item) => ({
    id: item.id,
    title: item.title || "",
    topicTitle: item.topicTitle || "",
    listTitle: item.listTitle || "",
    topic: item.topic || "",
    genre: item.genre || "",
    type: item.type || "",
    rank: item.rank,
    rating: item.rating,
    imageUrl: item.imageUrl || "",
    description: item.description || ""
  }));
}
