import { db } from "./firebase.js";
import {
    collection,
    getDocs,
    addDoc,
    query,
    orderBy,
    serverTimestamp,
    doc,
    getDoc,
    updateDoc,
    deleteDoc,
    increment,
    arrayUnion,
    arrayRemove
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
const auth = getAuth();

let currentPostId = null;
let posts = new Map();

function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function (m) { return map[m]; });
}

function formatCommentText(text) {
    if (!text) return '';

    let formatted = escapeHtml(text);

    formatted = formatted
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/__(.*?)__/g, '<u>$1</u>')
        .replace(/~~(.*?)~~/g, '<s>$1</s>')
        .replace(/@(\w+)/g, '<span class="mention">@$1</span>')
        .replace(/\n/g, '<br>');

    return formatted;
}

function formatDate(date) {
    if (!date) return 'Unknown date';

    const validDate = date && typeof date.toDate === 'function' ? date.toDate() : new Date(date);
    if (isNaN(validDate.getTime())) {
        return 'Unknown date';
    }
    return validDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function savePostToFirestore(postData) {
    try {
        const user = auth.currentUser;

        const docRef = await addDoc(collection(db, "newfeeds"), {
            title: postData.title,
            content: postData.content,
            author: postData.author || (user ? user.email : 'Anonymous User'),
            authorId: user ? user.uid : null,
            imageUrl: postData.imageUrl || null,
            createdAt: serverTimestamp(),
            likedBy: [],
            comments: []
        });

        console.log("Document written with ID: ", docRef.id);

        dispatchPostsUpdatedEvent();

        return docRef;
    } catch (error) {
        console.error("Error adding document: ", error);
        throw error;
    }
}

async function loadNewfeeds() {
    const newfeedsContainer = document.getElementById("newfeeds");
    if (!newfeedsContainer) {
        console.error("Newfeeds container not found");
        return;
    }

    try {
        showLoading();

        const q = query(collection(db, "newfeeds"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);

        const existingPosts = newfeedsContainer.querySelectorAll('.card2');
        existingPosts.forEach(post => post.remove());

        hideLoading();

        if (snapshot.empty) {
            newfeedsContainer.innerHTML = '<p class="no-posts">No posts available yet.</p>';
            dispatchPostsUpdatedEvent();
            return;
        }

        snapshot.forEach(doc => {
            const postData = { id: doc.id, ...doc.data() };
            posts.set(doc.id, postData);
            const postCard = renderNewfeed(postData);
            newfeedsContainer.appendChild(postCard);
        });

        dispatchPostsUpdatedEvent();

    } catch (err) {
        console.error("Error loading newfeeds:", err);
        hideLoading();
        showNotification('Failed to load posts. Please try again.', 'error');
    }
}

function dispatchPostsUpdatedEvent() {
    const event = new CustomEvent('postsUpdated');
    document.dispatchEvent(event);
}

async function toggleLikePost(postId) {
    try {
        const user = auth.currentUser;
        if (!user) {
            showNotification('Please log in to like posts', 'warning');
            return;
        }

        const postRef = doc(db, "newfeeds", postId);
        const postDoc = await getDoc(postRef);

        if (!postDoc.exists()) {
            showNotification('Post not found', 'error');
            return;
        }

        const postData = postDoc.data();
        const likedBy = postData.likedBy || [];
        const userId = user.uid;

        let isLiked;

        if (likedBy.includes(userId)) {
            await updateDoc(postRef, {
                likedBy: arrayRemove(userId)
            });
            isLiked = false;
        } else {
            await updateDoc(postRef, {
                likedBy: arrayUnion(userId)
            });
            isLiked = true;
        }

        const updatedPostDoc = await getDoc(postRef);
        const updatedPostData = updatedPostDoc.data();
        const updatedLikedBy = updatedPostData.likedBy || [];

        const updatedFullPostData = {
            id: postId,
            ...updatedPostData
        };
        posts.set(postId, updatedFullPostData);

        updateLikeButtonUI(postId, updatedLikedBy, isLiked);

        dispatchPostsUpdatedEvent();

        showNotification(isLiked ? 'Post liked!' : 'Post unliked!', 'success');

    } catch (error) {
        console.error("Error toggling like:", error);
        showNotification('Failed to update like. Please try again.', 'error');
    }
}

function updateLikeButtonUI(postId, likedBy, isLiked) {
    if (currentPostId === postId) {
        const likeCountSpan = document.querySelector('.comment3-react span');
        const likeButton = document.querySelector('.comment3-react button');

        if (likeCountSpan) {
            likeCountSpan.textContent = likedBy.length;
        }

        if (likeButton) {
            const heartIcon = likeButton.querySelector('svg path');
            if (heartIcon) {
                if (isLiked) {
                    heartIcon.style.fill = '#f5356e';
                    heartIcon.style.stroke = '#f5356e';
                    likeButton.classList.add('liked');
                } else {
                    heartIcon.style.fill = '#707277';
                    heartIcon.style.stroke = '#707277';
                    likeButton.classList.remove('liked');
                }
            }
        }
    }

    const postCard = document.querySelector(`[data-post-id="${postId}"]`);
    if (postCard) {
        const likesSpan = postCard.querySelector('.post-stats span');
        if (likesSpan) {
            likesSpan.textContent = `${likedBy.length} likes`;
        }
    }
}

function checkIfUserLikedPost(postData) {
    const user = auth.currentUser;
    if (!user || !postData.likedBy) return false;
    return postData.likedBy.includes(user.uid);
}

async function addComment(postId, commentText) {
    try {
        const user = auth.currentUser;
        if (!user) {
            showNotification('Please log in to comment', 'warning');
            return;
        }

        const comment = {
            id: Date.now().toString(),
            text: commentText,
            author: user.email,
            authorId: user.uid,
            createdAt: new Date()
        };

        const postRef = doc(db, "newfeeds", postId);

        await updateDoc(postRef, {
            comments: arrayUnion(comment)
        });

        const updatedPostDoc = await getDoc(postRef);
        if (updatedPostDoc.exists()) {
            const updatedPostData = {
                id: postId,
                ...updatedPostDoc.data()
            };
            posts.set(postId, updatedPostData);

            if (currentPostId === postId) {
                displayPostDetail(updatedPostData);
            }
        }

        dispatchPostsUpdatedEvent();

        showNotification('Comment added!', 'success');

    } catch (error) {
        console.error("Error adding comment:", error);
        showNotification('Failed to add comment. Please try again.', 'error');
    }
}

// ============= XÓA BÀI VIẾT =============
async function deletePost(postId) {
    try {
        const user = auth.currentUser;
        if (!user) {
            showNotification('Please log in to delete posts', 'warning');
            return;
        }

        const postRef = doc(db, "newfeeds", postId);
        const postDoc = await getDoc(postRef);

        if (!postDoc.exists()) {
            showNotification('Post not found', 'error');
            return;
        }

        const postData = postDoc.data();

        if (postData.authorId !== user.uid) {
            showNotification('You can only delete your own posts', 'error');
            return;
        }

        const confirmed = await showDeleteConfirmation();

        if (confirmed) {
            showLoading();
            await deleteDoc(postRef);
            posts.delete(postId);

            if (currentPostId === postId) {
                closePostDetail();
            }

            await loadNewfeeds();
            hideLoading();
            showNotification('Post deleted successfully!', 'success');
        }

    } catch (error) {
        console.error("Error deleting post:", error);
        hideLoading();
        showNotification('Failed to delete post. Please try again.', 'error');
    }
}

function showDeleteConfirmation() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'delete-confirmation-overlay';
        const isDarkMode = document.body.classList.contains('dark-mode');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10002;
            animation: fadeIn 0.3s ease-out;
        `;

        overlay.innerHTML = `
    <div class="delete-confirmation-dialog" style="
        background: ${isDarkMode ? '#2a2a2a' : 'white'};
        padding: 30px;
        border-radius: 12px;
        max-width: 400px;
        width: 90%;
        text-align: center;
        animation: slideUp 0.3s ease-out;
    ">
        <div style="
            width: 60px;
            height: 60px;
            margin: 0 auto 20px;
            background: ${isDarkMode ? 'rgba(244, 67, 54, 0.2)' : '#fee'};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        ">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="#f44336">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
        </div>
        <h3 style="margin: 0 0 10px; color: ${isDarkMode ? '#e0e0e0' : '#333'};">Delete Post?</h3>
        <p style="color: ${isDarkMode ? '#aaa' : '#666'}; margin: 0 0 25px; font-size: 14px;">
            Are you sure you want to delete this post? This action cannot be undone.
        </p>
        <div style="display: flex; gap: 10px; justify-content: center;">
            <button class="cancel-delete-btn" style="
                padding: 10px 24px;
                border: 1px solid ${isDarkMode ? '#555' : '#ddd'};
                background: ${isDarkMode ? '#3a3a3a' : 'white'};
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 600;
                color: ${isDarkMode ? '#ccc' : '#666'};
                transition: all 0.3s;
            ">Cancel</button>
            <button class="confirm-delete-btn" style="
                padding: 10px 24px;
                border: none;
                background: #f44336;
                color: white;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 600;
                transition: all 0.3s;
            ">Delete</button>
        </div>
    </div>
`;

        document.body.appendChild(overlay);

        const cancelBtn = overlay.querySelector('.cancel-delete-btn');
        const confirmBtn = overlay.querySelector('.confirm-delete-btn');

        cancelBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(false);
        });

        confirmBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(true);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(false);
            }
        });

        cancelBtn.addEventListener('mouseenter', () => {
            cancelBtn.style.background = isDarkMode ? '#4a4a4a' : '#f5f5f5';
        });
        cancelBtn.addEventListener('mouseleave', () => {
            cancelBtn.style.background = isDarkMode ? '#3a3a3a' : 'white';
        });

        confirmBtn.addEventListener('mouseenter', () => {
            confirmBtn.style.background = '#d32f2f';
        });
        confirmBtn.addEventListener('mouseleave', () => {
            confirmBtn.style.background = '#f44336';
        });
    });
}

// ============= MỞ FORM CHỈNH SỬA =============
function openEditForm(postData) {
    const overlay = document.getElementById("overlay");
    const postForm = document.getElementById("postForm");
    const titleInput = document.getElementById("postTitle");
    const contentInput = document.getElementById("postContent");
    const imagePreview = document.getElementById("imagePreview");

    titleInput.value = postData.title || '';
    contentInput.value = postData.content || '';

    if (postData.imageUrl) {
        imagePreview.innerHTML = `<img src="${postData.imageUrl}" alt="Preview" class="image-preview">`;
    }

    postForm.setAttribute('data-edit-id', postData.id);

    const formTitle = overlay.querySelector('h4');
    const submitBtn = overlay.querySelector('.form-submit-btn');
    formTitle.textContent = 'Edit Post';
    submitBtn.textContent = 'Update';

    overlay.style.display = "flex";
}

// ============= CẬP NHẬT BÀI VIẾT =============
async function updatePost(postId, postData) {
    try {
        const user = auth.currentUser;
        if (!user) {
            showNotification('Please log in to update posts', 'warning');
            return;
        }

        const postRef = doc(db, "newfeeds", postId);
        const postDoc = await getDoc(postRef);

        if (!postDoc.exists()) {
            showNotification('Post not found', 'error');
            return;
        }

        const currentData = postDoc.data();

        if (currentData.authorId !== user.uid) {
            showNotification('You can only edit your own posts', 'error');
            return;
        }

        showLoading();

        await updateDoc(postRef, {
            title: postData.title,
            content: postData.content,
            imageUrl: postData.imageUrl || currentData.imageUrl,
            updatedAt: serverTimestamp()
        });

        const updatedPostDoc = await getDoc(postRef);
        posts.set(postId, { id: postId, ...updatedPostDoc.data() });

        hidePopup();
        hideLoading();
        showNotification('Post updated successfully!', 'success');
        await loadNewfeeds();

    } catch (error) {
        console.error("Error updating post:", error);
        hideLoading();
        showNotification('Failed to update post. Please try again.', 'error');
    }
}

function renderNewfeed(postData) {
    const card = document.createElement("div");
    card.classList.add("card2");
    card.style.cursor = "pointer";
    card.setAttribute("data-post-id", postData.id);

    let cardHTML = '';

    if (postData.imageUrl) {
        cardHTML += `<div class="card2-image" style="background-image: url(${postData.imageUrl});"></div>`;
    }

    if (postData.title) {
        const isMobile = window.innerWidth < 768;
        const maxLength = isMobile ? 30 : postData.title.length;
        const truncatedTitle = postData.title.length > maxLength
            ? postData.title.substring(0, maxLength) + '...'
            : postData.title;
        cardHTML += `<p class="card2-title">${escapeHtml(truncatedTitle)}</p>`;
    }

    if (postData.content) {
        const isMobile = window.innerWidth < 768;
        const maxLength = isMobile ? 70 : 150;
        const truncatedContent = postData.content.length > maxLength
            ? postData.content.substring(0, maxLength) + '...'
            : postData.content;
        cardHTML += `<p class="card2-body">${escapeHtml(truncatedContent)}</p>`;
    }

    const author = postData.author || 'Anonymous';
    const date = formatDate(postData.createdAt);
    const likes = postData.likedBy ? postData.likedBy.length : 0;
    const commentCount = postData.comments ? postData.comments.length : 0;

    const user = auth.currentUser;
    const isOwner = user && postData.authorId === user.uid;

    cardHTML += `
        <div class="post-stats">
            <span>${likes} likes</span>
            <span>${commentCount} comments</span>
        </div>
        <p class="card-footer">Posted by <span class="by-name">${escapeHtml(author)}</span> on <span class="date">${date}</span></p>
        ${isOwner ? `
            <div class="post-actions" style="display: flex; gap: 8px; padding: 10px;">
                <button class="edit-post-btn" data-post-id="${postData.id}" style="
                    flex: 1;
                    padding: 8px 12px;
                    background: teal;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 600;
                    transition: all 0.3s;
                ">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="white" style="vertical-align: middle; margin-right: 4px;">
                        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                    </svg>
                    Edit
                </button>
                <button class="delete-post-btn" data-post-id="${postData.id}" style="
                    flex: 1;
                    padding: 8px 12px;
                    background: #f44336;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 600;
                    transition: all 0.3s;
                ">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="white" style="vertical-align: middle; margin-right: 4px;">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                    Delete
                </button>
            </div>
        ` : ''}
    `;

    card.innerHTML = cardHTML;

    card.addEventListener('click', (e) => {
        if (!e.target.closest('.edit-post-btn') && !e.target.closest('.delete-post-btn') && !e.target.closest('.post-actions')) {
            displayPostDetail(postData);
        }
    });

    if (isOwner) {
        const editBtn = card.querySelector('.edit-post-btn');
        const deleteBtn = card.querySelector('.delete-post-btn');

        editBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditForm(postData);
        });

        deleteBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            deletePost(postData.id);
        });

        editBtn?.addEventListener('mouseenter', () => {
            editBtn.style.background = 'rgb(0, 97, 97)';
        });
        editBtn?.addEventListener('mouseleave', () => {
            editBtn.style.background = 'teal';
        });

        deleteBtn?.addEventListener('mouseenter', () => {
            deleteBtn.style.background = '#d32f2f';
        });
        deleteBtn?.addEventListener('mouseleave', () => {
            deleteBtn.style.background = '#f44336';
        });
    }

    return card;
}

function displayPostDetail(postData) {
    currentPostId = postData.id;

    let card3Container = document.querySelector('.card3-container');
    if (!card3Container) {
        card3Container = document.createElement('div');
        card3Container.className = 'card3-container';
        card3Container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;
        document.body.appendChild(card3Container);
    }

    const likes = postData.likedBy ? postData.likedBy.length : 0;
    const comments = postData.comments || [];
    const isLiked = checkIfUserLikedPost(postData);

    card3Container.innerHTML = `
        <div class="card3" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
            <span class="title3">
                ${escapeHtml(postData.title || 'Post Details')}
                <button class="close-detail-btn" style="float: right; background: none; border: none; font-size: 24px; cursor: pointer; color: #707277;">&times;</button>
            </span>
            <div class="post-detail-content" style="padding: 20px;">
                ${postData.imageUrl ? `<img src="${postData.imageUrl}" style="max-width: 100%; height: auto; border-radius: 8px; margin-bottom: 15px;" alt="Post image">` : ''}
                <p style="font-size: 14px; line-height: 1.6; color: #5f6064; margin-bottom: 15px;">${escapeHtml(postData.content)}</p>
                <p style="font-size: 12px; color: #acaeb4; margin-bottom: 20px;">
                    Posted by ${escapeHtml(postData.author || 'Anonymous')} on ${formatDate(postData.createdAt)}
                </p>
            </div>
            <div class="comments3">
                <div class="comment3-react">
                    <button onclick="toggleCurrentPostLike()" title="Like this post" class="${isLiked ? 'liked' : ''}">
                        <svg fill="none" viewBox="0 0 24 24" height="16" width="16" xmlns="http://www.w3.org/2000/svg">
                            <path fill="${isLiked ? '#f5356e' : '#707277'}" stroke-linecap="round" stroke-width="2" stroke="${isLiked ? '#f5356e' : '#707277'}" d="M19.4626 3.99415C16.7809 2.34923 14.4404 3.01211 13.0344 4.06801C12.4578 4.50096 12.1696 4.71743 12 4.71743C11.8304 4.71743 11.5422 4.50096 10.9656 4.06801C9.55962 3.01211 7.21909 2.34923 4.53744 3.99415C1.01807 6.15294 0.221721 13.2749 8.33953 19.2834C9.88572 20.4278 10.6588 21 12 21C13.3412 21 14.1143 20.4278 15.6605 19.2834C23.7783 13.2749 22.9819 6.15294 19.4626 3.99415Z"></path>
                        </svg>
                    </button>
                    <hr>
                    <span>${likes}</span>
                </div>
                <div class="comment3-container">
                    <div class="comments-list">
                        ${comments.map(comment => `
                            <div class="user3" style="margin-bottom: 15px;">
                                <div class="user3-pic">
                                    <svg fill="none" viewBox="0 0 24 24" height="20" width="20" xmlns="http://www.w3.org/2000/svg">
                                        <path stroke-linejoin="round" fill="#707277" stroke-linecap="round" stroke-width="2" stroke="#707277" d="M6.57757 15.4816C5.1628 16.324 1.45336 18.0441 3.71266 20.1966C4.81631 21.248 6.04549 22 7.59087 22H16.4091C17.9545 22 19.1837 21.248 20.2873 20.1966C22.5466 18.0441 18.8372 16.324 17.4224 15.4816C14.1048 13.5061 9.89519 13.5061 6.57757 15.4816Z"></path>
                                        <path stroke-width="2" fill="#707277" stroke="#707277" d="M16.5 6.5C16.5 8.98528 14.4853 11 12 11C9.51472 11 7.5 8.98528 7.5 6.5C7.5 4.01472 9.51472 2 12 2C14.4853 2 16.5 4.01472 16.5 6.5Z"></path>
                                    </svg>
                                </div>
                                <div class="user3-info">
                                    <span>${escapeHtml(comment.author)}</span>
                                    <p>${formatDate(comment.createdAt)}</p>
                                </div>
                            </div>
                            <p class="comment3-content" style="margin-bottom: 15px;">${formatCommentText(comment.text)}</p>
                        `).join('')}
                    </div>
                </div>
            </div>

            <div class="text3-box">
                <div class="box3-container">
                    <textarea placeholder="Write a comment..." id="commentTextarea" style="min-height: 60px;"></textarea>
                    <div>
                        <div class="formatting3">
                            <button type="button" onclick="formatText('bold')" title="Bold">
                                <svg fill="none" viewBox="0 0 24 24" height="16" width="16" xmlns="http://www.w3.org/2000/svg">
                                    <path stroke-linejoin="round" stroke-linecap="round" stroke-width="2.5" stroke="#707277" d="M5 6C5 4.58579 5 3.87868 5.43934 3.43934C5.87868 3 6.58579 3 8 3H12.5789C15.0206 3 17 5.01472 17 7.5C17 9.98528 15.0206 12 12.5789 12H5V6Z" clip-rule="evenodd" fill-rule="evenodd"></path>
                                    <path stroke-linejoin="round" stroke-linecap="round" stroke-width="2.5" stroke="#707277" d="M12.4286 12H13.6667C16.0599 12 18 14.0147 18 16.5C18 18.9853 16.0599 21 13.6667 21H8C6.58579 21 5.87868 21 5.43934 20.5607C5 20.1213 5 19.4142 5 18V12"></path>
                                </svg>
                            </button>
                            <button type="button" onclick="formatText('italic')" title="Italic">
                                <svg fill="none" viewBox="0 0 24 24" height="16" width="16" xmlns="http://www.w3.org/2000/svg">
                                    <path stroke-linecap="round" stroke-width="2.5" stroke="#707277"d="M12 4H19"></path>
                                    <path stroke-linecap="round" stroke-width="2.5" stroke="#707277" d="M8 20L16 4"></path>
                                    <path stroke-linecap="round" stroke-width="2.5" stroke="#707277" d="M5 20H12"></path>
                                </svg>
                            </button>
                            <button type="button" onclick="formatText('underline')" title="Underline">
                                <svg fill="none" viewBox="0 0 24 24" height="16" width="16" xmlns="http://www.w3.org/2000/svg">
                                    <path stroke-linejoin="round" stroke-linecap="round" stroke-width="2.5" stroke="#707277" d="M5.5 3V11.5C5.5 15.0899 8.41015 18 12 18C15.5899 18 18.5 15.0899 18.5 11.5V3"></path>
                                    <path stroke-linecap="round" stroke-width="2.5" stroke="#707277" d="M3 21H21"></path>
                                </svg>
                            </button>
                            <button type="button" onclick="formatText('strikethrough')" title="Strikethrough">
                                <svg fill="none" viewBox="0 0 24 24" height="16" width="16" xmlns="http://www.w3.org/2000/svg">
                                    <path stroke-linejoin="round" stroke-linecap="round" stroke-width="2.5" stroke="#707277" d="M4 12H20"></path>
                                    <path stroke-linecap="round" stroke-width="2.5" stroke="#707277" d="M17.5 7.66667C17.5 5.08934 15.0376 3 12 3C8.96243 3 6.5 5.08934 6.5 7.66667C6.5 8.15279 6.55336 8.59783 6.6668 9M6 16.3333C6 18.9107 8.68629 21 12 21C15.3137 21 18 19.6667 18 16.3333C18 13.9404 16.9693 12.5782 14.9079 12"></path>
                                </svg>
                            </button>
                            <button type="button" onclick="addMention()" title="Mention">
                                <span style="font-weight: bold; color: #707277;">@</span>
                            </button>
                            <button type="button" onclick="submitComment()" class="send3" title="Send Comment">
                                <svg fill="none" viewBox="0 0 24 24" height="18" width="18" xmlns="http://www.w3.org/2000/svg">
                                    <path stroke-linejoin="round" stroke-linecap="round" stroke-width="2.5" stroke="#ffffff" d="M12 5L12 20"></path>
                                    <path stroke-linejoin="round" stroke-linecap="round" stroke-width="2.5" stroke="#ffffff" d="M7 9L11.2929 4.70711C11.6262 4.37377 11.7929 4.20711 12 4.20711C12.2071 4.20711 12.3738 4.37377 12.7071 4.70711L17 9"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    card3Container.querySelector('.close-detail-btn').addEventListener('click', closePostDetail);

    card3Container.addEventListener('click', (e) => {
        if (e.target === card3Container) {
            closePostDetail();
        }
    });

    card3Container.style.display = 'flex';
}

function closePostDetail() {
    const card3Container = document.querySelector('.card3-container');
    if (card3Container) {
        card3Container.style.display = 'none';
    }
    currentPostId = null;
}

function formatText(type) {
    const textarea = document.getElementById('commentTextarea');
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);

    if (!selectedText) {
        showNotification('Please select text to format', 'warning');
        return;
    }

    let formattedText = '';
    switch (type) {
        case 'bold':
            formattedText = `**${selectedText}**`;
            break;
        case 'italic':
            formattedText = `*${selectedText}*`;
            break;
        case 'underline':
            formattedText = `__${selectedText}__`;
            break;
        case 'strikethrough':
            formattedText = `~~${selectedText}~~`;
            break;
        default:
            return;
    }

    textarea.value = textarea.value.substring(0, start) + formattedText + textarea.value.substring(end);
    textarea.focus();
    textarea.setSelectionRange(start, start + formattedText.length);
}

function addMention() {
    const textarea = document.getElementById('commentTextarea');
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, cursorPos);
    const textAfter = textarea.value.substring(cursorPos);

    textarea.value = textBefore + '@username ' + textAfter;
    textarea.focus();
    textarea.setSelectionRange(cursorPos + 1, cursorPos + 9);
}

window.toggleCurrentPostLike = async function () {
    if (currentPostId) {
        await toggleLikePost(currentPostId);
    }
};

window.submitComment = async function () {
    const textarea = document.getElementById('commentTextarea');
    if (!textarea || !currentPostId) return;

    const commentText = textarea.value.trim();
    if (!commentText) {
        showNotification('Please enter a comment', 'warning');
        return;
    }

    await addComment(currentPostId, commentText);
    textarea.value = '';
};

window.formatText = formatText;
window.addMention = addMention;
window.displayPostDetail = displayPostDetail;

function showLoading() {
    const loaderSection = document.getElementById('loaderSection');
    if (loaderSection) {
        loaderSection.style.display = 'flex';
    }
}

function hideLoading() {
    const loaderSection = document.getElementById('loaderSection');
    if (loaderSection) {
        loaderSection.style.display = 'none';
    }
}

function hidePopup() {
    const overlay = document.getElementById("overlay");
    const postForm = document.getElementById("postForm");
    const imagePreview = document.getElementById("imagePreview");

    if (overlay) {
        overlay.style.display = "none";
    }
    if (postForm) {
        postForm.reset();
        postForm.removeAttribute('data-edit-id');

        const formTitle = overlay.querySelector('h4');
        const submitBtn = overlay.querySelector('.form-submit-btn');
        if (formTitle) formTitle.textContent = 'Create New Post';
        if (submitBtn) submitBtn.textContent = 'Post';
    }
    if (imagePreview) {
        imagePreview.innerHTML = "";
    }
}

function getIconPath(type) {
    switch (type) {
        case "success":
            return "M8.5 11.5 11 14l4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z";
        case "info":
            return "M10 11h2v5m-2 0h4m-2.592-8.5h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z";
        case "warning":
            return "M12 13V8m0 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z";
        case "error":
        default:
            return "m15 9-6 6m0-6 6 6m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z";
    }
}

function showNotification(message, type = 'success') {
    const container = document.querySelector(".notification-container");
    if (!container) {
        console.warn("Notification container not found");
        return;
    }

    const li = document.createElement("li");
    li.classList.add("notification-item", type);

    li.innerHTML = `
        <div class="notification-content">
            <div class="notification-icon">
                <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="${getIconPath(type)}" />
                </svg>
            </div>
            <div class="notification-text">${message}</div>
        </div>
        <div class="notification-icon notification-close">
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M6 18 17.94 6M18 18 6.06 6" />
            </svg>
        </div>
        <div class="notification-progress-bar"></div>
    `;

    container.appendChild(li);

    const autoRemoveTimer = setTimeout(() => {
        if (li.parentNode) {
            li.remove();
        }
    }, 5000);

    li.querySelector(".notification-close")?.addEventListener("click", () => {
        clearTimeout(autoRemoveTimer);
        li.remove();
    });
}

function initializePopupHandlers() {
    const inputText = document.getElementById("input-text");
    const overlay = document.getElementById("overlay");
    const closeBtn = document.getElementById("closeBtn");
    const cancelBtn = document.getElementById("cancelBtn");
    const imageInput = document.getElementById("imageInput");
    const imagePreview = document.getElementById("imagePreview");

    inputText?.addEventListener("click", () => {
        if (overlay) {
            overlay.style.display = "flex";
        }
    });

    closeBtn?.addEventListener("click", hidePopup);
    cancelBtn?.addEventListener("click", hidePopup);

    overlay?.addEventListener("click", (e) => {
        if (e.target === overlay) {
            hidePopup();
        }
    });

    imageInput?.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file && imagePreview) {
            const reader = new FileReader();
            reader.onload = (e) => {
                imagePreview.innerHTML = `<img src="${e.target.result}" alt="Preview" class="image-preview">`;
            };
            reader.readAsDataURL(file);
        } else if (imagePreview) {
            imagePreview.innerHTML = "";
        }
    });
}

function initializeFormHandler() {
    const postForm = document.getElementById("postForm");
    const imageInput = document.getElementById("imageInput");

    postForm?.addEventListener("submit", async (e) => {
        e.preventDefault();

        const formData = new FormData(postForm);
        const title = formData.get('title')?.trim();
        const content = formData.get('content')?.trim();
        const imageFile = imageInput?.files[0];
        const editId = postForm.getAttribute('data-edit-id');

        if (!title || !content) {
            showNotification('Please fill in all required fields.', 'error');
            return;
        }

        try {
            showLoading();

            const postData = {
                title: title,
                content: content,
                imageUrl: null
            };

            if (imageFile) {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    postData.imageUrl = e.target.result;

                    try {
                        if (editId) {
                            await updatePost(editId, postData);
                        } else {
                            postData.author = auth.currentUser ? auth.currentUser.email : 'Anonymous User';
                            await savePostToFirestore(postData);
                        }
                        postForm.removeAttribute('data-edit-id');
                        hidePopup();
                        hideLoading();
                        await loadNewfeeds();
                    } catch (error) {
                        console.error("Error processing post:", error);
                        hideLoading();
                        showNotification('Failed to process post. Please try again.', 'error');
                    }
                };
                reader.readAsDataURL(imageFile);
            } else {
                if (editId) {
                    await updatePost(editId, postData);
                } else {
                    postData.author = auth.currentUser ? auth.currentUser.email : 'Anonymous User';
                    await savePostToFirestore(postData);
                }
                postForm.removeAttribute('data-edit-id');
                hidePopup();
                hideLoading();
                await loadNewfeeds();
            }

        } catch (error) {
            console.error("Error processing post:", error);
            hideLoading();
            showNotification('Failed to process post. Please try again.', 'error');
        }
    });
}

function initializeHamburgerMenu() {
    const hamburger = document.querySelector('.hamburger input');
    const sideMenu = document.getElementById('sideMenu');

    if (!hamburger || !sideMenu) {
        console.warn("Hamburger menu elements not found");
        return;
    }

    hamburger.addEventListener('change', () => {
        if (hamburger.checked) {
            sideMenu.classList.add('show');
            document.body.style.overflow = 'hidden';
        } else {
            sideMenu.classList.remove('show');
            document.body.style.overflow = '';
        }
    });

    document.addEventListener('click', (e) => {
        if (!sideMenu.contains(e.target) && !hamburger.parentElement.contains(e.target)) {
            hamburger.checked = false;
            sideMenu.classList.remove('show');
            document.body.style.overflow = '';
        }
    });
}

async function migrateLikesData() {
    try {
        const q = query(collection(db, "newfeeds"));
        const snapshot = await getDocs(q);

        for (const docSnapshot of snapshot.docs) {
            const data = docSnapshot.data();
            if (data.likes !== undefined && !data.likedBy) {
                await updateDoc(doc(db, "newfeeds", docSnapshot.id), {
                    likedBy: [],
                    likes: null
                });
                console.log(`Migrated post ${docSnapshot.id}`);
            }
        }
    } catch (error) {
        console.error("Error migrating likes data:", error);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    console.log("Initializing application...");

    initializePopupHandlers();
    initializeFormHandler();
    initializeHamburgerMenu();

    loadNewfeeds();

    console.log("Application initialized successfully");
});

export {
    loadNewfeeds,
    hidePopup,
    showNotification,
    savePostToFirestore,
    displayPostDetail,
    closePostDetail,
    deletePost,
    updatePost,
    openEditForm
};
