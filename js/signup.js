import {
    createUserWithEmailAndPassword,
    sendEmailVerification,
    signOut,
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import { auth, db } from "./firebase.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { showNotification } from "./notification.js";

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("register-form");
    if (!form) return console.error("Can not find form #register-form");

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = form.username.value.trim();
        const email = form.email.value.trim();
        const password = form.password.value;
        const confirmPassword = form.confirmPassword.value;

        if (password !== confirmPassword) {
            showNotification("The confirmation password does not match!", "warning");
            return;
        }

        const usernameRegex = /^[A-Za-z0-9_]{3,20}$/;
        if (!usernameRegex.test(username)) {
            showNotification("Username must be 3–20 characters, only letters, numbers, or underscore.", "info");
            return;
        }

        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
        if (!passwordRegex.test(password)) {
            showNotification("Password must include uppercase, lowercase, and a number and must be at least 8 characters in length", "info");
            return;
        }

        try {
            const usernameRef = doc(db, "usernames", username.toLowerCase());
            const usernameSnap = await getDoc(usernameRef);
            if (usernameSnap.exists()) {
                showNotification("Username is already taken!", "error");
                return;
            }

            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const { user } = userCredential;

            await setDoc(usernameRef, { uid: user.uid, email, createdAt: new window.Date() });

            try {
                await sendEmailVerification(user);
                showNotification("Registration successful. Check your email to verify your account!", "success");

                await signOut(auth);
                form.reset();
                window.location.href = "./login.html";
            } catch (err) {
                showNotification("Failed to send verification email. Please try again.", "error");
            }

            window.location.href = "./login.html";

        } catch (err) {
            console.error(err.code, err.message);
            switch (err.code) {
                case "auth/email-already-in-use":
                    showNotification("Email is already in use.", "error");
                    break;
                case "auth/invalid-email":
                    showNotification("Invalid email format.", "error");
                    break;
                case "auth/weak-password":
                    showNotification("Your password is too weak.", "warning");
                    break;
                default:
                    showNotification("Registration error: " + err.message, "error");
            }
        }
    });
});

// Google Sign-In
const googleButton = document.querySelector(".google-signup-button");
if (googleButton) {
    googleButton.addEventListener("click", async () => {
        const provider = new GoogleAuthProvider();
        try {
            const userCredential = await signInWithPopup(auth, provider);
            const usernameAllLowercase = userCredential.user.displayName.replace(/\s+/g, '').toLowerCase();
            await setDoc(doc(db, "usernames", usernameAllLowercase), {
                uid: userCredential.user.uid,
                email: userCredential.user.email,
                createdAt: new window.Date(),
            });
            showNotification("Login successful!", "success");
            setTimeout(() => {
                if (window.hideLoader) window.hideLoader();
                window.location.href = "./index.html";
            }, 1000);
        } catch (error) {
            const errorMessage = error.message;
            switch (errorMessage) {
                case "auth/popup-closed-by-user":
                    showNotification("Popup closed before completing sign-in.", "error");
                    break;
                case "auth/cancelled-popup-request":
                    showNotification("Only one popup request is allowed at one time.", "error");
                    break;
                case "auth/popup-blocked":
                    showNotification("Popup was blocked by the browser.", "error");
                    break;
                case "auth/operation-not-allowed":
                    showNotification("Operation not allowed. Please contact support.", "error");
                    break;
                default:
                    showNotification("Login error: " + errorMessage, "error");
            }
        }
    });
} else {
    console.error("Can not find .google-signup-button");
}


