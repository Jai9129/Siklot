// SicKloT - Main JavaScript

// Smooth active nav-link highlighting on scroll
document.addEventListener('DOMContentLoaded', () => {
    const sections = document.querySelectorAll('section[id], header[id]');
    const navLinks = document.querySelectorAll('.nav-links a');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                navLinks.forEach(link => {
                    link.classList.remove('active');
                    if (link.getAttribute('href') === `#${entry.target.id}`) {
                        link.classList.add('active');
                    }
                });
            }
        });
    }, { threshold: 0.4 });

    sections.forEach(section => observer.observe(section));
});

// Fetch Live Discord Stats
async function fetchDiscordStats() {
    const el = document.getElementById('discordCounts');
    if (!el) return;
    try {
        const res = await fetch('https://discord.com/api/v9/invites/YWmDpp5q3M?with_counts=true');
        const data = await res.json();
        if (data && data.approximate_member_count) {
            el.innerHTML = `<strong>${data.approximate_presence_count}</strong> Online &nbsp;•&nbsp; <strong>${data.approximate_member_count}</strong> Members`;
        } else {
            el.innerHTML = 'Join our growing community!';
        }
    } catch (e) {
        el.innerHTML = 'Join our growing community!';
    }
}

// Fetch Recent Feedback for Homepage
async function fetchHomeFeedback() {
    const grid = document.getElementById('homeFeedbackGrid');
    if (!grid) return;
    try {
        const res = await fetch(window.getApiUrl('/api/feedback'));
        const json = await res.json();
        
        if (json.success && json.data.length > 0) {
            // Get up to 3 most recent 5-star reviews
            const topReviews = json.data.filter(f => f.rating === 5).slice(0, 3);
            if (topReviews.length === 0) topReviews.push(...json.data.slice(0, 3)); // Fallback if no 5-star
            
            grid.innerHTML = '';
            topReviews.forEach(fb => {
                const starsHTML = Array(5).fill(0).map((_, i) => 
                    `<i class="fa-solid fa-star" style="color:${i < fb.rating ? '#f59e0b' : '#3f4255'}"></i>`
                ).join('');
                
                const initial = fb.name.substring(0,2).toUpperCase();
                
                grid.innerHTML += `
                    <div class="review-card" style="padding: 28px; border-radius: 16px; border: 1px solid var(--border-subtle); background: rgba(255,255,255,0.02); backdrop-filter: blur(12px);">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <div style="width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, var(--blue-base), var(--blue-glow)); display: flex; align-items: center; justify-content: center; font-weight: 700; font-family: 'Outfit'; color: #fff;">
                                    ${initial}
                                </div>
                                <div>
                                    <h4 style="margin: 0; font-size: 1.05rem;">${fb.name}</h4>
                                    <span style="font-size: 0.8rem; color: var(--text-muted);">${fb.submittedAt ? fb.submittedAt.split(' at ')[0] : 'Recently'}</span>
                                </div>
                            </div>
                            <div style="color: #f59e0b; font-size: 0.9rem;">${starsHTML}</div>
                        </div>
                        <div style="color: var(--text-dark); line-height: 1.6; font-size: 0.95rem;">"${fb.message}"</div>
                    </div>
                `;
            });
        } else {
            grid.innerHTML = '<div style="text-align:center; padding: 40px; color: var(--text-muted); grid-column: 1/-1;">No reviews yet.</div>';
        }
    } catch(e) {
        grid.innerHTML = '';
    }
}

// Ensure functions run if elements exist
document.addEventListener('DOMContentLoaded', () => {
    fetchDiscordStats();
    fetchHomeFeedback();
});
