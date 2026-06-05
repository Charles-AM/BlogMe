# Neon Frames Anime Blog

A production-ready static anime blog with a cyberpunk UI, Firebase Firestore persistence, Firebase Authentication for a private owner console, rankings with public likes, and an editable AI draft generator.

## Files

- `index.html` - public blog grid and full post view
- `rankings.html` - public anime leaderboard
- `archive.html` - chronological post archive
- `admin.html` - private owner console, rename before deploying
- `style.css` - responsive neon/glassmorphism design
- `script.js` - Firebase reads/writes, rendering, likes, CRUD, AI draft calls
- `firebase-config.js` - your Firebase web config

## 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project**.
3. Name it, for example `neon-frames-blog`.
4. Google Analytics is optional.
5. Open the project.

## 2. Add a Web App and Copy Config

1. In Firebase Console, open **Project settings**.
2. Under **Your apps**, click the web icon.
3. Register the app.
4. Copy the Firebase config object.
5. Paste the values into `firebase-config.js`.

```js
export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID"
};
```

## 3. Enable Firestore

1. In Firebase Console, open **Build > Firestore Database**.
2. Click **Create database**.
3. Start in production mode.
4. Choose a region near your audience.

Collections are created automatically when you save your first post or ranking:

- `posts`
- `rankings`

## 4. Enable Authentication

1. Open **Build > Authentication**.
2. Click **Get started**.
3. Enable **Email/Password**.
4. Go to **Users**.
5. Click **Add user**.
6. Create your one owner/admin account.
7. Copy that user's UID if you want stricter Firestore rules.

## 5. Firestore Security Rules

Use public reads so anyone can visit the blog. Use authenticated writes for the owner console.

Basic one-admin-site rules:

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

Stricter owner-only write rules:

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

The public like button increments only the `likes` field.

## 6. Rename the Admin Page

The public site never links to the admin page. Before deploying, rename:

```bash
mv admin.html admin-xyz789.html
```

Use your own hard-to-guess filename. Bookmark it privately.

## 7. Seed Demo Data

`script.js` includes a commented `seedDemoData()` helper at the bottom. To use it:

1. Configure Firebase.
2. Open your renamed admin page.
3. Sign in.
4. Open the browser console.
5. Copy the commented function from `script.js`, paste it into the console, and run:

```js
seedDemoData();
```

It creates 5 sample posts and 10 ranking entries.

## 8. AI Draft Generator

The AI draft tool lives only on the private admin page.

Workflow:

1. Sign in.
2. Choose **Gemini** or **OpenAI**.
3. Paste your API key.
4. Enter a topic, such as `Why Frieren made me cry`.
5. Click **Generate draft**.
6. Edit the preview freely.
7. Click **Publish** only when it is ready.

Nothing is posted automatically.

The exact prompt in `script.js` enforces short sentences, emotion, humor, no bullet points, no AI clichés, and a 150-300 word review style.

Cost note:

- Gemini has a free tier through [Google AI Studio](https://aistudio.google.com/app/apikey).
- OpenAI usually costs about `$0.002-$0.01` per short draft, depending on model and token count.

API key note:

The key is stored in `localStorage` for convenience. That is acceptable for a personal owner-only tool, but it is not a secure multi-user production secret store.

## 9. Deploy to Netlify

Drag-and-drop:

1. Rename `admin.html`.
2. Go to [Netlify Drop](https://app.netlify.com/drop).
3. Drag the entire project folder into the page.
4. Netlify gives you a live URL.

Netlify CLI:

```bash
npm install -g netlify-cli
netlify deploy --dir .
netlify deploy --prod --dir .
```

Run those commands from this folder.

## 10. Local Preview

Because this uses ES modules, preview it with a local static server:

```bash
python3 -m http.server 8080
```

Then open:

```txt
http://localhost:8080
```

## 11. Daily Use

Posts:

1. Open the secret admin page.
2. Sign in.
3. Fill in title, image URL, date, category, tags, and content.
4. Click **Publish post**.
5. Existing posts can be edited or deleted in **Existing Content**.

Rankings:

1. Fill in rank number, title, image URL, description, rating, and genre.
2. Click **Save ranking**.
3. Rankings can be edited or deleted later.
4. Public visitors can like rankings without signing in.

Public pages:

- `index.html` shows paginated blog cards.
- `rankings.html` shows filterable rankings.
- `archive.html` groups every post by month/year.

