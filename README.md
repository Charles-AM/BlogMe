# Regressed Ranker

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

Public visitors can read posts. Only a signed-in admin can write posts.

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
      allow create, update: if
        request.auth != null ||
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['likes']);
      allow delete: if request.auth != null;
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
      allow create, delete: if isOwner();
      allow update: if isOwner() ||
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['likes']);
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
   - Build command: leave blank
   - Publish directory: `.`
7. Deploy.

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
4. Use **List title / Genre** as the general heading, for example `Best Sports Anime`.
5. Use the same list title for every item that should appear under that heading.
6. Click **Save recommendation**.
7. The recommendation appears on `recommendations.html`.

Example:

```txt
List title / Genre: Best Sports Anime
Rank number: 1
Title: Ao Ashi
Image URL: ...
Description: ...
```
