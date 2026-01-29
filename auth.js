import { auth } from './firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const authMsg = document.getElementById("auth-msg");

document.getElementById("registerBtn").addEventListener("click", () => {
  createUserWithEmailAndPassword(auth, emailInput.value, passwordInput.value)
    .then(() => { authMsg.textContent = "Account created! Redirecting..."; window.location.href = "game.html"; })
    .catch(err => authMsg.textContent = err.message);
});

document.getElementById("loginBtn").addEventListener("click", () => {
  signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value)
    .then(() => { authMsg.textContent = "Logged in! Redirecting..."; window.location.href = "game.html"; })
    .catch(err => authMsg.textContent = err.message);
});


