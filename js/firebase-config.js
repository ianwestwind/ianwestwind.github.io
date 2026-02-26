// ============================================================
// WINN Platforms — firebase-config.js
//
// SETUP INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com/
// 2. Create a new project (or open an existing one)
// 3. Go to Project Settings → Your Apps → Add a Web App
// 4. Copy the firebaseConfig object values below
// 5. Enable Authentication → Email/Password in Firebase Console
// 6. Enable Firestore Database in Firebase Console
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ↓↓↓ Replace these placeholder values with your Firebase project config ↓↓↓
const firebaseConfig = {
  apiKey:            "AIzaSyB5NhAxZqoTK9fHtTm6MsIEJAyKRgts4eM",
  authDomain:        "winn-website-29cd1.firebaseapp.com",
  projectId:         "winn-website-29cd1",
  storageBucket:     "winn-website-29cd1.firebasestorage.app",
  messagingSenderId: "732720714159",
  appId:             "1:732720714159:web:81d386f0e486f2c2e09f5a"
};
// ↑↑↑ End of config section ↑↑↑

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

export { app, auth, db };
