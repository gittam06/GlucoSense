// src/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// PASTE THE CONFIG YOU JUST COPIED FROM FIREBASE RIGHT HERE:
const firebaseConfig = {
  apiKey: "AIzaSyBkMPd5qeqjIvbKLzRSlUfEeOp8M7KX0tY",
  authDomain: "glucosense-36e64.firebaseapp.com",
  databaseURL: "https://glucosense-36e64-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "glucosense-36e64",
  storageBucket: "glucosense-36e64.firebasestorage.app",
  messagingSenderId: "847303361369",
  appId: "1:847303361369:web:b3b645ee7283afef628248"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Realtime Database and export it so App.jsx can use it
export const db = getDatabase(app);