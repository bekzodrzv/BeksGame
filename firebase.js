// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCjb_SxZGmzVQdrY9bCceyEP4jYVTAq8Ps",
    authDomain: "beks-game.firebaseapp.com",
    projectId: "beks-game",
    storageBucket: "beks-game.firebasestorage.app",
    messagingSenderId: "101120658989",
    appId: "1:101120658989:web:513fd1ef29a003605a72a4",
    measurementId: "G-TJHYR914SQ"
  };


const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);