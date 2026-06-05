# Regressed Ranker

A light, clean Firebase blog for anime, manga, manhua, and ranking-style posts.

## Pages

- `index.html` - public blog homepage and full post view
- `recommendations.html` - ranked anime, manga, and manhua recommendations
- `archive.html` - public archive grouped by month and year
- `admin.html` - private post dashboard, not linked publicly
- `style.css` - white gradient responsive UI
- `script.js` - Firebase, rendering, post CRUD, archive logic
- `firebase-config.js` - Firebase web app config
- `netlify.toml` - Netlify static hosting config

## Firebase Setup

1. Open [Firebase Console](https://console.firebase.google.com/).
2. Create or open your project.
3. Go to **Build > Firestore Database**.
4. Create the database in production mode.
5. Go to **Build > Authentication**.
6. Enable **Email/Password**.
7. Go to **Users** and create one admin user.

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

## Admin Page

Open:

```txt
admin.html
```

Sign in with your Firebase admin user. From there you can:

- create posts
- edit posts
- delete posts
- create recommendations
- edit recommendations
- delete recommendations
- set title, image, date, category, tags, and content

The public site does not link to `admin.html`.

Before going live, rename it to something private:

```bash
mv admin.html admin-your-secret-name.html
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
http://localhost:8080/admin.html
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

1. Rename `admin.html`.
2. Go to [Netlify Drop](https://app.netlify.com/drop).
3. Drag the project folder into the page.

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
4. Click **Save recommendation**.
5. The recommendation appears on `recommendations.html`.
