const PROJECT_ID = "blogme-4edc1";
const SITE_URL = "https://regressedranker.xyz";

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function readFirestoreString(field) {
  return field?.stringValue || "";
}

function readFirestoreTimestamp(field) {
  const value = field?.timestampValue || field?.stringValue || "";
  return value ? new Date(value) : new Date();
}

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function excerpt(content = "", max = 280) {
  const plain = String(content).replace(/[#*_`>-]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max).trim()}...` : plain;
}

function toRfc822(date) {
  return date.toUTCString();
}

exports.handler = async () => {
  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/posts`
    );

    if (!response.ok) {
      throw new Error(`Firestore returned ${response.status}`);
    }

    const payload = await response.json();
    const posts = (payload.documents || [])
      .map((document) => {
        const fields = document.fields || {};
        const id = document.name.split("/").pop();
        const title = readFirestoreString(fields.title);
        const content = readFirestoreString(fields.content);
        const imageUrl = readFirestoreString(fields.imageUrl);
        const date = readFirestoreTimestamp(fields.date || fields.createdAt);
        return {
          id,
          title,
          content,
          imageUrl,
          date,
          link: `${SITE_URL}/index.html?post=${id}-${slugify(title)}`
        };
      })
      .filter((post) => post.title)
      .sort((a, b) => b.date - a.date)
      .slice(0, 20);

    const items = posts.map((post) => `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(post.link)}</link>
      <guid isPermaLink="true">${escapeXml(post.link)}</guid>
      <pubDate>${toRfc822(post.date)}</pubDate>
      <description>${escapeXml(excerpt(post.content))}</description>
      ${post.imageUrl ? `<enclosure url="${escapeXml(post.imageUrl)}" type="image/jpeg" />` : ""}
    </item>`).join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Regressed Ranker</title>
    <link>${SITE_URL}</link>
    <description>Anime, manga, manhua, and recommendation posts from Regressed Ranker.</description>
    <language>en-us</language>
    <lastBuildDate>${toRfc822(new Date())}</lastBuildDate>${items}
  </channel>
</rss>`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=900, s-maxage=3600"
      },
      body: xml
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=60"
      },
      body: `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Regressed Ranker</title><description>RSS temporarily unavailable.</description></channel></rss>`
    };
  }
};
