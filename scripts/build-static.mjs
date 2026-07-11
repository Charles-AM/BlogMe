import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPosts, fetchRankings } from "./lib/firestore.mjs";
import {
  SITE_URL,
  buildRecommendationLists,
  categoryCanonicalPath,
  categorySitemapUrl,
  getCategoryTopics,
  getRecommendationTopics,
  isSimpleListPost,
  listCanonicalPath,
  listSitemapUrl,
  postCanonicalPath,
  postDescription,
  postHref,
  postOgImage,
  recommendationTopicCanonicalPath,
  renderArchiveHtml,
  renderCategoryHubHtml,
  renderMetaTags,
  renderPostBodyHtml,
  renderPostsGridHtml,
  renderRecommendationTopicBodyHtml,
  renderRecommendationsHubHtml,
  resolvePostSlug,
  serializeFeedForClient,
  serializeRankingsForClient,
  slugify,
  sortFeedItems,
  isoDate,
  escapeHtml
} from "./lib/render.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");

const COPY_PATHS = [
  "assets",
  "style.css",
  "script.js",
  "firebase-config.js",
  "about.html",
  "contact.html",
  "privacy.html",
  "terms.html",
  "recommendations.html",
  "rr-vault-9k4m2.html"
];

function copyStaticAssets() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  for (const item of COPY_PATHS) {
    cpSync(join(ROOT, item), join(DIST, item), { recursive: true });
  }
}

function replaceBetween(html, startMarker, endMarker, replacement) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    throw new Error(`Could not find markers: ${startMarker}`);
  }
  return `${html.slice(0, start + startMarker.length)}${replacement}${html.slice(end)}`;
}

function injectHomepage(feedItems) {
  let html = readFileSync(join(ROOT, "index.html"), "utf8");
  const { cardsHtml, paginationHtml } = renderPostsGridHtml(feedItems);
  const feedJson = JSON.stringify(serializeFeedForClient(feedItems));

  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    '<meta name="description" content="Regressed Ranker is a clean anime blog for reviews, essays, and watch notes.">'
  );

  html = replaceBetween(html, '<div class="blog-grid" id="posts-grid" aria-live="polite">', "</div>", `\n${cardsHtml}\n`);
  html = replaceBetween(html, '<div class="pagination recent-posts-toggle" id="pagination">', "</div>", paginationHtml ? `\n${paginationHtml}\n` : "\n");

  const emptyClass = feedItems.length ? "empty-state hidden" : "empty-state";
  html = html.replace(/class="empty-state hidden" id="posts-empty"/, `class="${emptyClass}" id="posts-empty"`);

  html = html.replace(
    "</body>",
    `    <script id="posts-feed-data" type="application/json">${feedJson}</script>\n  </body>`
  );

  writeFileSync(join(DIST, "index.html"), html, "utf8");
}

function injectArchive(feedItems) {
  let html = readFileSync(join(ROOT, "archive.html"), "utf8");
  const archiveHtml = renderArchiveHtml(feedItems);

  html = replaceBetween(html, '<div class="archive-list" id="archive-list" aria-live="polite">', "</div>", archiveHtml ? `\n${archiveHtml}\n` : "\n");

  const emptyClass = feedItems.length ? "empty-state hidden" : "empty-state";
  html = html.replace(/class="empty-state hidden" id="archive-empty"/, `class="${emptyClass}" id="archive-empty"`);

  writeFileSync(join(DIST, "archive.html"), html, "utf8");
}

function renderStaticPageShell({
  title,
  description,
  canonicalPath,
  image,
  type = "website",
  body,
  dataPage
}) {
  const meta = renderMetaTags({ title, description, canonicalPath, image, type });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${meta}
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/style.css">
  </head>
  <body data-page="${escapeHtml(dataPage)}">
    <div class="site-shell">
      <header class="public-header">
        <a class="brand" href="/index.html" aria-label="Regressed Ranker home">
          <span class="brand-mark">RR</span>
          <span>
            <strong>Regressed Ranker</strong>
            <small>Anime · Manga · Ranker</small>
          </span>
        </a>
        <nav class="public-nav" aria-label="Primary navigation">
          <a href="/index.html" data-step="01">Home</a>
          <a href="/recommendations.html" data-step="02">Recommendations</a>
          <a href="/archive.html" data-step="03">All Posts</a>
        </nav>
      </header>

      <main>
        ${body}
      </main>
      <footer class="site-footer">
        <a href="/about.html">About</a>
        <a href="/contact.html">Contact</a>
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
      </footer>
    </div>

    <script type="module" src="/script.js"></script>
  </body>
</html>
`;
}

function renderPostPageShell(post) {
  const title = `${post.title} | Regressed Ranker`;
  const description = postDescription(post);
  const canonicalPath = postCanonicalPath(post);

  return renderStaticPageShell({
    title,
    description,
    canonicalPath,
    image: postOgImage(post),
    type: "article",
    dataPage: isSimpleListPost(post) ? "list" : "post",
    body: renderPostBodyHtml(post)
  });
}

function renderRecommendationTopicPageShell(topicMeta) {
  const title = `${topicMeta.topic} | Recommendations | Regressed Ranker`;

  return renderStaticPageShell({
    title,
    description: topicMeta.description,
    canonicalPath: topicMeta.canonicalPath,
    image: topicMeta.image,
    type: "article",
    dataPage: "recommendation-topic",
    body: renderRecommendationTopicBodyHtml(topicMeta.topic, topicMeta.items)
  });
}

function renderCategoryPageShell(categoryMeta) {
  const title = `${categoryMeta.category} | Regressed Ranker`;

  return renderStaticPageShell({
    title,
    description: categoryMeta.description,
    canonicalPath: categoryMeta.canonicalPath,
    image: `${SITE_URL}/assets/regressed-ranker-hero.jpg`,
    type: "website",
    dataPage: "category",
    body: renderCategoryHubHtml(categoryMeta.category, categoryMeta.posts)
  });
}

function injectRecommendations(rankings) {
  let html = readFileSync(join(ROOT, "recommendations.html"), "utf8");
  const recommendationsHtml = renderRecommendationsHubHtml(rankings);
  const topics = getRecommendationTopics(rankings);
  const description = topics.length
    ? `Browse ${topics.length} curated anime, manga, and manhua recommendation lists from Regressed Ranker.`
    : "Anime, manga, and manhua recommendations from Regressed Ranker.";
  const rankingsJson = JSON.stringify(serializeRankingsForClient(rankings));

  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${escapeHtml(description)}">`
  );

  html = replaceBetween(
    html,
    '<div class="leaderboard" id="rankings-list" aria-live="polite">',
    "</div>",
    recommendationsHtml ? `\n${recommendationsHtml}\n` : "\n"
  );

  const emptyClass = rankings.length ? "empty-state hidden" : "empty-state";
  html = html.replace(/class="empty-state hidden" id="rankings-empty"/, `class="${emptyClass}" id="rankings-empty"`);

  html = html.replace(
    "</body>",
    `    <script id="rankings-feed-data" type="application/json">${rankingsJson}</script>\n  </body>`
  );

  writeFileSync(join(DIST, "recommendations.html"), html, "utf8");
}

function writePostPages(posts) {
  for (const post of posts) {
    if (post.kind === "recommendation" || isSimpleListPost(post)) continue;
    const postId = String(post.id).toLowerCase();
    const dir = join(DIST, "posts", postId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), renderPostPageShell(post), "utf8");
  }
}

function writeListPages(posts) {
  for (const post of posts) {
    if (!isSimpleListPost(post)) continue;
    const slug = resolvePostSlug(post);
    const dir = join(DIST, "lists", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), renderPostPageShell(post), "utf8");
  }
}

function writeRecommendationTopicPages(topics) {
  for (const topicMeta of topics) {
    const dir = join(DIST, "recommendations", topicMeta.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), renderRecommendationTopicPageShell(topicMeta), "utf8");
  }
}

function writeCategoryPages(categories) {
  for (const categoryMeta of categories) {
    const dir = join(DIST, "category", categoryMeta.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), renderCategoryPageShell(categoryMeta), "utf8");
  }
}

function escapeSitemapLoc(url = "") {
  return String(url)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function writeSitemap(blogPosts, recommendationTopics, categoryTopics) {
  const staticPages = [
    { loc: `${SITE_URL}/`, changefreq: "weekly", priority: "1.0" },
    { loc: `${SITE_URL}/recommendations.html`, changefreq: "weekly", priority: "0.9" },
    { loc: `${SITE_URL}/archive.html`, changefreq: "weekly", priority: "0.8" },
    { loc: `${SITE_URL}/about.html`, changefreq: "monthly", priority: "0.6" },
    { loc: `${SITE_URL}/contact.html`, changefreq: "monthly", priority: "0.5" },
    { loc: `${SITE_URL}/privacy.html`, changefreq: "yearly", priority: "0.3" },
    { loc: `${SITE_URL}/terms.html`, changefreq: "yearly", priority: "0.3" }
  ];

  const today = new Date().toISOString().slice(0, 10);
  const articlePosts = blogPosts.filter((post) => !isSimpleListPost(post));
  const listPosts = blogPosts.filter((post) => isSimpleListPost(post));

  const postUrls = articlePosts.map((post) => ({
    loc: `${SITE_URL}${postCanonicalPath(post)}`,
    lastmod: isoDate(post.date),
    changefreq: "monthly",
    priority: "0.7"
  }));

  const listUrls = listPosts.map((post) => ({
    loc: listSitemapUrl(post),
    lastmod: isoDate(post.date),
    changefreq: "monthly",
    priority: "0.7"
  }));

  const recommendationUrls = recommendationTopics.map((topic) => ({
    loc: topic.sitemapUrl,
    lastmod: topic.lastmod,
    changefreq: "monthly",
    priority: "0.65"
  }));

  const categoryUrls = categoryTopics.map((category) => ({
    loc: category.sitemapUrl,
    lastmod: category.lastmod,
    changefreq: "weekly",
    priority: "0.75"
  }));

  const urls = [
    ...staticPages.map((page) => ({ ...page, lastmod: today })),
    ...categoryUrls,
    ...postUrls,
    ...listUrls,
    ...recommendationUrls
  ];
  const body = urls.map((url) => `  <url>
    <loc>${escapeSitemapLoc(url.loc)}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;

  writeFileSync(join(DIST, "sitemap.xml"), xml, "utf8");
  console.log(`Wrote sitemap.xml with ${urls.length} URLs (${categoryUrls.length} categories, ${postUrls.length} articles, ${listUrls.length} lists, ${recommendationUrls.length} recommendations).`);
}

function writeRobotsTxt() {
  const robots = `User-agent: *
Disallow: /rr-vault-9k4m2.html

Sitemap: ${SITE_URL}/sitemap.xml
`;
  writeFileSync(join(DIST, "robots.txt"), robots, "utf8");
}

function writeRedirects(blogPosts, recommendationTopics) {
  const lines = [
    "# Legacy post URLs -> static post pages",
    "/index.html?post=:post /posts/:post/ 301",
    "/?post=:post /posts/:post/ 301"
  ];

  for (const post of blogPosts) {
    const lowerId = String(post.id).toLowerCase();
    const listPath = listCanonicalPath(post);

    if (isSimpleListPost(post)) {
      lines.push(`/posts/${lowerId}/ ${listPath} 301`);
      lines.push(`/posts/${post.id}/ ${listPath} 301`);
    } else if (lowerId !== post.id) {
      lines.push(`/posts/${post.id}/ /posts/${lowerId}/ 301`);
      lines.push(`/posts/${post.id} /posts/${lowerId}/ 301`);
    }

    const slug = slugify(post.title || "");
    if (slug) {
      const target = isSimpleListPost(post) ? listPath : `/posts/${lowerId}/`;
      lines.push(`/index.html?post=${post.id}-${slug} ${target} 301`);
      lines.push(`/?post=${post.id}-${slug} ${target} 301`);
    }
  }

  for (const topicMeta of recommendationTopics) {
    const encodedTopic = encodeURIComponent(topicMeta.topic);
    lines.push(`/recommendations.html?topic=${encodedTopic} ${topicMeta.canonicalPath} 301`);
  }

  writeFileSync(join(DIST, "_redirects"), `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  console.log("Fetching posts and rankings from Firestore...");
  const [posts, rankings] = await Promise.all([
    fetchPosts(),
    fetchRankings().catch(() => [])
  ]);

  const feedItems = sortFeedItems([...posts, ...buildRecommendationLists(rankings)]);
  const blogPosts = posts.filter((post) => post.kind !== "recommendation");
  const recommendationTopics = getRecommendationTopics(rankings);
  const categoryTopics = getCategoryTopics(blogPosts);
  const articleCount = blogPosts.filter((post) => !isSimpleListPost(post)).length;
  const listCount = blogPosts.filter((post) => isSimpleListPost(post)).length;

  console.log(`Found ${articleCount} articles, ${listCount} character lists, ${rankings.length} ranking items, and ${recommendationTopics.length} recommendation topics.`);

  copyStaticAssets();
  injectHomepage(feedItems);
  injectArchive(feedItems);
  injectRecommendations(rankings);
  writePostPages(blogPosts);
  writeListPages(blogPosts);
  writeRecommendationTopicPages(recommendationTopics);
  writeCategoryPages(categoryTopics);
  writeSitemap(blogPosts, recommendationTopics, categoryTopics);
  writeRobotsTxt();
  writeRedirects(blogPosts, recommendationTopics);

  console.log(`Built ${articleCount} article pages, ${listCount} list pages, ${recommendationTopics.length} recommendation pages, and ${categoryTopics.length} category hubs into dist/.`);
}

main().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});
