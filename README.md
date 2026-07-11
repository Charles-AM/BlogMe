# BlogMe

A light, clean Firebase blog for anime, manga, manhua, and ranking-style posts.

## Pages

- `index.html` - public blog homepage and full post view
- `recommendations.html` - ranked anime, manga, and manhua recommendations
- `archive.html` - public archive grouped by month and year
- `rr-vault-9k4m2.html` - private admin dashboard, not linked publicly
- `style.css` - white gradient responsive UI
- `script.js` - Firebase, rendering, post CRUD, archive logic
- `firebase-config.js` - Firebase web app config
- `netlify.toml` - Netlify static hosting config
- `assets/regressed-ranker-hero.jpg` - homepage banner image

## Firebase Setup

1. Open [Firebase Console](https://console.firebase.google.com/).
2. Create or open your project.
3. Go to **Build > Firestore Database**.
4. Create the database in production mode.
5. Go to **Build > Authentication**.
6. Enable **Email/Password**.
7. Go to **Users** and create one admin user.
8. Go to **Build > Storage**.
9. Create Firebase Storage so pasted admin images can upload.

## Firestore Rules

Public visitors can read posts and recommendations. They can also create anonymous analytics page-view events. Only a signed-in admin can read analytics or write site content.

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /posts/{postId} {
      allow read: if true;
      allow write: if request.auth != null;
    }

    match /rankings/{rankingId} {
      allow read: if true;
      allow write: if request.auth != null;
    }

    match /analyticsEvents/{eventId} {
      allow create: if request.resource.data.type == "page_view";
      allow read, update, delete: if request.auth != null;
    }
  }
}
```

## Storage Rules

Admin image paste/upload uses Firebase Storage. Public visitors can view images. Only signed-in admins can upload.

```txt
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    match /uploads/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

For stricter owner-only writes, use your Firebase Auth UID:

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function isOwner() {
      return request.auth != null && request.auth.uid == "PASTE_YOUR_ADMIN_UID_HERE";
    }

    match /posts/{postId} {
      allow read: if true;
      allow write: if isOwner();
    }

    match /rankings/{rankingId} {
      allow read: if true;
      allow write: if isOwner();
    }

    match /analyticsEvents/{eventId} {
      allow create: if request.resource.data.type == "page_view";
      allow read, update, delete: if isOwner();
    }
  }
}
```

You can also paste that same UID into `adminUid` in `firebase-config.js`. That makes the admin page sign out any other authenticated user immediately. Firestore rules are still the real security layer.

## Admin Page

Open:

```txt
rr-vault-9k4m2.html
```

Sign in with your Firebase admin user. From there you can:

- create posts
- edit posts
- delete posts
- create recommendations
- edit recommendations
- delete recommendations
- view anonymous visit and page-read analytics
- set title, image, date, category, tags, and content

For image fields, you can either paste an image URL or click the field and paste an image from your clipboard. Pasted images upload to Firebase Storage and the URL is filled automatically.

The public site does not link to the private admin page.

You can rename it again before going live:

```bash
mv rr-vault-9k4m2.html your-private-name.html
```

## Local Preview

Run this inside the project folder:

```bash
python3 -m http.server 8080
```

Open:

```txt
http://localhost:8080
```

Admin:

```txt
http://localhost:8080/rr-vault-9k4m2.html
```

## Deploy to Netlify

### GitHub Method

1. Push this repo to GitHub.
2. Go to [Netlify](https://app.netlify.com/).
3. Click **Add new site > Import an existing project**.
4. Choose GitHub.
5. Select the `BlogMe` repo.
6. Use these settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
7. Deploy.

The build step fetches your published Firestore posts and generates static HTML for crawlers and social previews. After you publish or edit a post in the admin page, trigger a new Netlify deploy so the static pages update.

### Rebuild after publishing

Every time you publish, edit, or delete a blog post **or save a recommendation**:

1. Open your site in Netlify.
2. Go to **Deploys**.
3. Click **Trigger deploy > Deploy site**.

Or open your Netlify build hook URL in the browser (one click).

The build pre-renders:

- all blog posts at `/posts/{id}/`
- all recommendation lists on `recommendations.html` (full ranked content in HTML)
- the homepage grid and archive
- `sitemap.xml` with every post and recommendation topic URL

### Local build

```bash
npm install
npm run build
```

This writes a `dist/` folder with:

- pre-filled homepage and archive HTML
- one static page per post at `/posts/{post-id}/`
- an updated `sitemap.xml` with every post URL
- `robots.txt` and legacy URL redirects

Preview the built site:

```bash
npx serve dist
```

### Drag-and-Drop Method

1. Keep the private admin page name unlinked, or rename it again.
2. Go to [Netlify Drop](https://app.netlify.com/drop).
3. Drag the project folder into the page.

## Custom Domain

After the site is deployed on Netlify:

1. Open the site in Netlify.
2. Go to **Domain management**.
3. Click **Add a domain**.
4. Enter your domain, for example `regressedranker.com`.
5. If you buy the domain through Netlify, Netlify handles DNS automatically.
6. If you buy it elsewhere, add the DNS records Netlify shows you.
7. Wait for Netlify to issue the free HTTPS certificate.

Recommended domain style:

- `regressedranker.com`
- `regressedranker.net`
- `regressedranker.blog`

## SEO and search indexing

The build generates `sitemap.xml` and `robots.txt` in `dist/` on every deploy.

**Current sitemap includes:**
- 7 static pages (home, recommendations, archive, about, contact, privacy, terms)
- every blog post at `/posts/{id}/`
- every recommendation topic at `recommendations.html?topic=...`

After each build + deploy, trigger your Netlify build hook so the sitemap stays current.

### Submit to Google Search Console

1. Open [Google Search Console](https://search.google.com/search-console).
2. Select the property **`regressedranker.xyz`** (Domain) or **`https://regressedranker.xyz/`** (URL prefix, non-www).
3. Do **not** use a `www` or `netlify.app` property — the sitemap lives on `regressedranker.xyz`.
4. In the left menu, open **Sitemaps**.
5. Delete any old failed `sitemap.xml` entries.
6. In **Add a new sitemap**, enter exactly:
   ```
   https://regressedranker.xyz/sitemap.xml
   ```
   If the field already shows your domain, try only `sitemap.xml` instead.
7. Click **Submit**. Status should change to **Success** within an hour (39 URLs discovered).

### If submission fails

- **URL inspection:** test `https://regressedranker.xyz/sitemap.xml` → **Test live URL** → must show fetch successful.
- **Property mismatch:** add a **Domain** property for `regressedranker.xyz` (DNS TXT verification) if you only have `www` or Netlify URL.
- **No manual submit needed:** `robots.txt` already contains `Sitemap: https://regressedranker.xyz/sitemap.xml` — Google will find it automatically.

### Verify static HTML

```bash
curl -s https://regressedranker.xyz/posts/YOUR_POST_ID/ | grep -E '<title>|<h1>|<p>'
```

Or use **View Page Source** in your browser. You should see the post title and body text without waiting for JavaScript.

### Request re-indexing in Google Search Console

1. Open [Google Search Console](https://search.google.com/search-console).
2. Select the `regressedranker.xyz` property.
3. Submit `https://regressedranker.xyz/sitemap.xml` under **Sitemaps**.
4. Use **URL inspection** on a post URL and click **Request indexing**.

## Posting

1. Open the private admin page.
2. Sign in.
3. Fill in the blog post form.
4. Click **Publish post**.
5. The post appears on `index.html`.
6. The post also appears in `archive.html`.

## Recommendations

1. Open the private admin page.
2. Sign in.
3. Fill in the recommendation form.
4. Use **Topic title** as the recommendation post title, for example `Best Sports Anime`.
5. Use the same topic title for every item that should appear under that one list.
6. Use **Genre / Type** for the individual item, for example `Soccer`, `Tennis`, `Boxing`, or `Basketball`.
7. Click **Save recommendation**.
8. The topic appears as one recommendation post on the homepage and `recommendations.html`, with the saved items grouped inside it.

Example:

```txt
Topic title: Best Sports Anime
Genre / Type: Soccer
Rank number: 1
Title: Ao Ashi
Image URL: ...
Description: ...
```

To create another recommendation post, use a different **Topic title**, for example `Best Romance Anime`.
