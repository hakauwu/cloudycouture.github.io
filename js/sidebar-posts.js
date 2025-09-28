import { 
    collection, 
    query, 
    orderBy, 
    limit, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { db } from "./firebase.js";

async function loadTopPostsToSidebar() {
    try {
        const postsRef = collection(db, "newfeeds"); 
        const allPostsQuery = query(postsRef, orderBy("createdAt", "desc"));

        const querySnapshot = await getDocs(allPostsQuery);
        
        if (querySnapshot.empty) {
            console.log("No posts found in newfeeds");
            showNoPostsMessage();
            return;
        }

        const allPosts = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const likeCount = data.likedBy ? data.likedBy.length : 0;
            allPosts.push({
                id: doc.id,
                likeCount: likeCount,
                ...data
            });
        });

        const topPosts = allPosts
            .sort((a, b) => b.likeCount - a.likeCount)
            .slice(0, 5);

        if (topPosts.length === 0) {
            showNoPostsMessage();
            return;
        }

        const shuffledTopPosts = topPosts.sort(() => 0.5 - Math.random());
        const selectedPosts = shuffledTopPosts.slice(0, Math.min(2, topPosts.length));

        displayTopPostsInSidebar(selectedPosts);

    } catch (error) {
        console.error("Error loading top posts from Firestore:", error);
        showErrorMessage();
    }
}

function displayTopPostsInSidebar(posts) {
    const sidebar = document.querySelector('.main-sidebar');
    
    if (!sidebar) {
        console.error("Sidebar not found");
        return;
    }

    const existingContainer = sidebar.querySelector('.top-posts-container');
    if (existingContainer) {
        existingContainer.remove();
    }
    
    const topPostsContainer = document.createElement('div');
    topPostsContainer.className = 'top-posts-container';
    
    const heading = document.createElement('h4');
    heading.style.cssText = `
        margin-bottom: 15px;
        color: #333;
        font-size: 1.2rem;
        font-weight: 600;
        border-bottom: 2px solid teal;
        padding-bottom: 5px;
    `;
    topPostsContainer.appendChild(heading);

    posts.forEach(post => {
        const postCard = document.createElement('div');
        postCard.className = 'card1';
        postCard.style.cssText = `
            cursor: pointer;
            margin-bottom: 15px;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        `;
        
        postCard.addEventListener('mouseenter', () => {
            postCard.style.transform = 'translateY(-2px)';
            postCard.style.boxShadow = '0 8px 25px rgba(0, 0, 0, 0.15)';
        });

        postCard.addEventListener('mouseleave', () => {
            postCard.style.transform = 'translateY(0)';
            postCard.style.boxShadow = '';
        });
        
        postCard.addEventListener('click', () => {
            openPostDetail(post);
        });

        const postDate = post.createdAt ? 
            (typeof post.createdAt.toDate === 'function' ? 
                post.createdAt.toDate().toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric'
                }) : 
                new Date(post.createdAt).toLocaleDateString('en-US', {
                    month: 'short', 
                    day: 'numeric'
                })
            ) : 'Recent';

        const commentCount = post.comments ? post.comments.length : 0;

        postCard.innerHTML = `
            <div class="body">
                <h5 style="color: aliceblue; margin-bottom: 8px; font-size: 1rem; line-height: 1.3;">
                    ${escapeHtml(post.title || 'Untitled Post')}
                </h5>
                <p class="text" style="margin-bottom: 10px; line-height: 1.4;">
                    ${truncateText(post.content || 'No content available', 80)}
                </p>
                <span class="username" style="font-size: 0.85rem;">
                    By: ${escapeHtml(post.author || 'Anonymous')}
                </span>
                <div class="footer" style="display: flex; align-items: center; justify-content: space-between; margin-top: 10px;">
                    <div style="display: flex; gap: 15px; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" style="width: 14px; height: 14px;">
                                <g id="SVGRepo_iconCarrier">
                                    <path stroke-linejoin="round" stroke-linecap="round" stroke-width="1.5" stroke="currentColor"
                                        d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z">
                                    </path>
                                </g>
                            </svg>
                            <span style="font-size: 0.8rem;">${post.likeCount || 0}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" style="width: 14px; height: 14px;">
                                <g id="SVGRepo_iconCarrier">
                                    <path stroke-linejoin="round" stroke-linecap="round" stroke-width="1.5" stroke="currentColor"
                                        d="M16 10H16.01M12 10H12.01M8 10H8.01M3 10C3 4.64706 5.11765 3 12 3C18.8824 3 21 4.64706 21 10C21 15.3529 18.8824 17 12 17C11.6592 17 11.3301 16.996 11.0124 16.9876L7 21V16.4939C4.0328 15.6692 3 13.7383 3 10Z">
                                    </path>
                                </g>
                            </svg>
                            <span style="font-size: 0.8rem;">${commentCount}</span>
                        </div>
                    </div>
                    <div style="font-size: 0.75rem; color: #9fa4aa;">
                        ${postDate}
                    </div>
                </div>
            </div>
        `;

        topPostsContainer.appendChild(postCard);
    });

    const existingCard = sidebar.querySelector('.card1');
    if (existingCard && existingCard.parentNode) {
        existingCard.parentNode.insertBefore(topPostsContainer, existingCard.nextSibling);
    } else {
        sidebar.appendChild(topPostsContainer);
    }
}

function openPostDetail(post) {
    if (window.displayPostDetail) {
        window.displayPostDetail(post);
    } else {
        const event = new CustomEvent('openPostDetail', { 
            detail: { post } 
        });
        document.dispatchEvent(event);
    }
    
    console.log('Opening post detail:', post);
}

function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > 0) {
        return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
}

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

function showNoPostsMessage() {
    const sidebar = document.querySelector('.main-sidebar');
    if (!sidebar) return;
    
    const container = document.createElement('div');
    container.className = 'top-posts-container';
    
    container.innerHTML = `
        <div style="padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: center; color: #666; border: 2px dashed #ddd;">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 48px; height: 48px; margin: 0 auto 10px; color: #ccc;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p style="margin: 0; font-style: italic;">No posts available yet.</p>
            <p style="margin: 5px 0 0; font-size: 0.85rem;">Be the first to create a post!</p>
        </div>
    `;
    
    const existingCard = sidebar.querySelector('.card1');
    if (existingCard && existingCard.parentNode) {
        existingCard.parentNode.insertBefore(container, existingCard.nextSibling);
    } else {
        sidebar.appendChild(container);
    }
}

function showErrorMessage() {
    const sidebar = document.querySelector('.main-sidebar');
    if (!sidebar) return;
    
    const container = document.createElement('div');
    container.className = 'top-posts-container';
    
    container.innerHTML = `
        <div style="padding: 20px; background: #ffebee; border-radius: 8px; text-align: center; color: #c62828; border: 2px dashed #ffcdd2;">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 48px; height: 48px; margin: 0 auto 10px; color: #c62828;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p style="margin: 0; font-weight: 500;">Unable to load popular posts</p>
            <p style="margin: 5px 0 0; font-size: 0.85rem;">Please try refreshing the page</p>
        </div>
    `;
    
    const existingCard = sidebar.querySelector('.card1');
    if (existingCard && existingCard.parentNode) {
        existingCard.parentNode.insertBefore(container, existingCard.nextSibling);
    } else {
        sidebar.appendChild(container);
    }
}

function refreshTopPosts() {
    const existingContainer = document.querySelector('.top-posts-container');
    if (existingContainer) {
        existingContainer.remove();
    }
    loadTopPostsToSidebar();
}

document.addEventListener('DOMContentLoaded', () => {
    loadTopPostsToSidebar();
});

document.addEventListener('postsUpdated', () => {
    refreshTopPosts();
});

export { loadTopPostsToSidebar, refreshTopPosts };
