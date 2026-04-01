/**
 * SicKloT API Connection Configuration
 * 
 * IMPORTANT: If you want anyone in the world to be able to register, 
 * you MUST change 'BACKEND_URL' below to the public link of your Node.js hosting!
 * 
 * Example: const BACKEND_URL = "https://siklot-backend.onrender.com";
 */
const BACKEND_URL = "https://devserver-main--sicklot.netlify.app"; 

window.getApiUrl = function(path) {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:') return 'http://localhost:3000' + path;
    if (window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.0.')) return 'http://' + window.location.hostname + ':3000' + path;
    return BACKEND_URL + path;
};

// =========================================================================
// STATIC DEMO MODE: Intercept API calls on Netlify and use LocalStorage
// =========================================================================
if (window.location.hostname.includes('netlify.app') || window.location.hostname.includes('github.io')) {
    console.log("SicKloT Static Demo Backend Initiated");
    if (!localStorage.getItem('db_users')) localStorage.setItem('db_users', '[]');
    if (!localStorage.getItem('db_msgs')) localStorage.setItem('db_msgs', '[]');
    if (!localStorage.getItem('db_feed')) localStorage.setItem('db_feed', '[]');

    const origFetch = window.fetch;
    window.fetch = async (url, opts) => {
        if (typeof url === 'string' && url.includes('/api/')) {
            const db = {
                users: JSON.parse(localStorage.getItem('db_users')),
                msgs: JSON.parse(localStorage.getItem('db_msgs')),
                feed: JSON.parse(localStorage.getItem('db_feed'))
            };
            const save = () => {
                localStorage.setItem('db_users', JSON.stringify(db.users));
                localStorage.setItem('db_msgs', JSON.stringify(db.msgs));
                localStorage.setItem('db_feed', JSON.stringify(db.feed));
            };
            const respond = (data) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });

            let body = {};
            if (opts && opts.body) try { body = JSON.parse(opts.body); } catch(e){}

            // 1. Auth 
            if (url.includes('/api/register')) {
                if (db.users.find(u => u.email === body.email || u.username === body.username)) return respond({ success: false, error: 'User already exists' });
                const u = { id: Date.now(), registeredAt: new Date().toLocaleDateString(), username: body.username, email: body.email, discord: body.discord||'', password: body.password, status: 'active' };
                db.users.push(u); save();
                return respond({ success: true, user: { id: u.id, username: u.username, email: u.email } });
            }
            if (url.includes('/api/login')) {
                const u = db.users.find(x => x.email === body.email && x.password === body.password);
                if (u) return respond({ success: true, user: { id: u.id, username: u.username, email: u.email } });
                return respond({ success: false, error: 'Invalid email or password' });
            }

            // 2. Forms
            if (url.includes('/api/contact')) {
                db.msgs.push({ id: Date.now(), receivedAt: new Date().toLocaleString(), firstName: body.firstName, lastName: body.lastName, email: body.email, discord: body.discord||'', service: body.service, message: body.message, status: 'unread' });
                save();
                return respond({ success: true });
            }
            if (url.includes('/api/feedback') && (!opts || opts.method==='GET')) return respond({ success: true, data: db.feed.slice().reverse() });
            if (url.includes('/api/feedback') && opts && opts.method==='POST') {
                db.feed.push({ id: Date.now(), submittedAt: new Date().toLocaleString(), name: body.name, rating: body.rating, message: body.message, status: 'approved' });
                save();
                return respond({ success: true });
            }

            // 3. Admin Panel
            if (url.includes('/api/admin/login')) {
                if (body.username === 'admin' && body.password === 'siklot2026') return respond({ success: true, token: 'demo-token' });
                return respond({ success: false, error: 'Invalid credentials' });
            }
            if (url.includes('/api/admin/logout')) return respond({ success: true });
            if (url.includes('/api/admin/stats')) return respond({ success: true, totalMessages: db.msgs.length, unreadMessages: db.msgs.filter(m=>m.status==='unread').length, totalUsers: db.users.length, activeUsers: db.users.filter(u=>u.status==='active').length, modeLabel: true, mode: 'local' });
            if (url.includes('/api/admin/messages') && (!opts||opts.method==='GET')) return respond({ success: true, messages: db.msgs.slice().reverse() });
            if (url.includes('/api/admin/users') && (!opts||opts.method==='GET')) return respond({ success: true, users: db.users.slice().reverse() });
            
            // Note: Admin edit/delete ignored for briefness unless they exactly match
            if (url.match(/\/api\/admin\/messages\/\d+\/read/)) {
                const id = parseInt(url.split('/').slice(-2)[0]);
                const m = db.msgs.find(x=>x.id===id); if(m){ m.status='read'; save(); }
                return respond({ success: true });
            }
            if (url.match(/\/api\/admin\/messages\/\d+/) && opts && opts.method==='DELETE') {
                const id = parseInt(url.split('/').pop());
                db.msgs = db.msgs.filter(x=>x.id!==id); save();
                return respond({ success: true });
            }
            if (url.match(/\/api\/admin\/users\/\d+\/action/)) {
                const id = parseInt(url.split('/').slice(-2)[0]);
                const u = db.users.find(x=>x.id===id); if(u){ u.status=body.action==='suspend'?'suspended':'active'; save(); }
                return respond({ success: true });
            }
            if (url.match(/\/api\/admin\/users\/\d+/) && opts && opts.method==='DELETE') {
                const id = parseInt(url.split('/').pop());
                db.users = db.users.filter(x=>x.id!==id); save();
                return respond({ success: true });
            }

            return respond({ success: false, error: 'Route not mocked' });
        }
        return origFetch(url, opts);
    };
}
