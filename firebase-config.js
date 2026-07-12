// Replace these placeholder values with your Firebase web app config.
// Firebase Console -> Project settings -> General -> Your apps -> Web app.
export const firebaseConfig = {
  apiKey: "AIzaSyDUCxkQQZ-9iGH2-hjG1v7qnTQHgKDi67s",
  authDomain: "blogme-4edc1.firebaseapp.com",
  projectId: "blogme-4edc1",
  storageBucket: "blogme-4edc1.firebasestorage.app",
  messagingSenderId: "64257809517",
  appId: "1:64257809517:web:216bd5bebe65478cd43364",
  measurementId: "G-E04JFLW1HY"
};

// Optional: paste your Firebase Authentication admin user's UID here.
// This is a client-side convenience check only. Firestore rules still enforce writes.
export const adminUid = "";

// Netlify build hook: triggers a site rebuild after you publish content.
export const netlifyBuildHookUrl = "https://api.netlify.com/build_hooks/6a526eac57c9fc94b0e4dc31";
