// Replace these values with your Firebase web app config, then upload this file
// with the rest of the site to GitHub Pages. The config is not a password; it
// only tells the page which Firebase Realtime Database to use.
window.RANKING_FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Keep this true for GitHub Pages sharing. If this is true and Firebase is not
// configured, the admin page will refuse to save instead of saving per-device.
window.RANKING_REQUIRE_REMOTE_STORAGE = true;

// Keep this value the same on every uploaded copy of the site. Changing it
// creates a separate shared data space.
window.RANKING_FIREBASE_PATH_PREFIX = "ranking-100";
