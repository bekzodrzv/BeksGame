import { auth } from './firebase.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");

// Register
registerBtn.addEventListener("click", () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    if(!email || !password){
        alert("Email va parol kiriting!");
        return;
    }
    createUserWithEmailAndPassword(auth, email, password)
        .then(() => {
            window.location.href = "game.html";
        })
        .catch(err => alert(err.message));
});

// Login
loginBtn.addEventListener("click", () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    if(!email || !password){
        alert("Email va parol kiriting!");
        return;
    }
    signInWithEmailAndPassword(auth, email, password)
        .then(() => {
            window.location.href = "game.html";
        })
        .catch(err => alert(err.message));
});
