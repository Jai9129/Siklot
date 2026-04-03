/**
 * SicKloT — Backend Server v3.0
 * ================================
 * Database: Google Sheets (auto-falls back to local JSON if not configured)
 *
 * SETUP GOOGLE SHEETS → See SETUP_GUIDE.md
 * START SERVER        → node server.js
 * ADMIN PANEL         → http://localhost:3000/admin.html
 */

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3000;

// ════ CONFIG ════════════════════════════════════════════════════════════
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'siklot2026';

// ↓↓↓ PASTE YOUR SPREADSHEET ID HERE AFTER COMPLETING SETUP_GUIDE.md ↓↓↓
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'YOUR_SPREADSHEET_ID_HERE';
// ↑↑↑ Example: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms' ↑↑↑

const CREDS_FILE = path.join(__dirname, 'google-credentials.json');

// ════ LOCAL FILE PATHS (fallback when Sheets not configured) ════════════
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const USERS_FILE    = path.join(__dirname, 'users.json');
const FEEDBACK_FILE = path.join(__dirname, 'feedback.json');
const VERIFICATION_FILE = path.join(__dirname, 'verification-codes.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

// ════ SHEET COLUMN LAYOUTS ═══════════════════════════════════════════════
const MSG_COLS  = ['id','receivedAt','firstName','lastName','email','discord','service','message','status'];
const USER_COLS = ['id','registeredAt','username','email','discord','passwordHash','salt','status'];
const FEEDBACK_COLS = ['id','submittedAt','name','rating','message','status'];

// ════ RUNTIME STATE ══════════════════════════════════════════════════════
let sheetsAPI  = null;  // Google Sheets API client (null = not connected)
let googleMode = false; // true when connected to Google Sheets
const adminSessions = new Map(); // token → expiry timestamp
let isMaintenance = true;       // Persistence flag

// Load settings on startup
if (fs.existsSync(SETTINGS_FILE)) {
    try {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
        isMaintenance = !!settings.isMaintenance;
    } catch(e) { console.error('Failed to load settings:', e.message); }
}

// ════ MIDDLEWARE ═════════════════════════════════════════════════════════
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ════ MAINTENANCE MIDDLEWARE ══════════════════════════════════════════════
app.use((req, res, next) => {
    // 1. Allow bypass if maintenance is OFF
    if (!isMaintenance) return next();

    // 2. Allow bypass if accessing Admin Panel or Admin APIs
    const reqPath = req.path.toLowerCase();
    const isAdminAPI = reqPath.startsWith('/api/admin/');
    const isAssetPath = reqPath.endsWith('.css') || reqPath.endsWith('.png') || reqPath.endsWith('.js') || reqPath.includes('favicon');
    const isMaintenancePage = reqPath === '/maintenance.html';

    if (isAdminAPI || isAssetPath || isMaintenancePage) return next();

    // 3. Otherwise, serve maintenance page
    // Note: If maintenance.html doesn't exist, we send a simple message
    const maintenanceFile = path.join(__dirname, 'maintenance.html');
    if (fs.existsSync(maintenanceFile)) {
        return res.sendFile(maintenanceFile);
    }
    res.status(503).send('<h1>SicKloT is currently under maintenance.</h1><p>We will be back shortly! Join our Discord for updates: <a href="https://discord.gg/YWmDpp5q3M">discord.gg/YWmDpp5q3M</a></p>');
});

app.use(express.static(__dirname));

// ════ HELPERS: TIMESTAMP ═════════════════════════════════════════════════
function nowIST() {
    return new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'medium',
    });
}

// ════ HELPERS: PASSWORD HASHING ═══════════════════════════════════════════
function hashPass(password, salt) {
    salt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return { hash, salt };
}
function verifyPass(password, salt, storedHash) {
    return hashPass(password, salt).hash === storedHash;
}

// ════ HELPERS: ADMIN AUTH ════════════════════════════════════════════════
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function requireAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token || !adminSessions.has(token)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (Date.now() > adminSessions.get(token)) {
        adminSessions.delete(token);
        return res.status(401).json({ success: false, error: 'Session expired' });
    }
    next();
}

// ════ HELPERS: LOCAL JSON ════════════════════════════════════════════════
function loadJSON(file) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[]', 'utf-8');
    try   { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
    catch { return []; }
}
function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// ════ HELPERS: GOOGLE SHEETS ══════════════════════════════════════════════

/** Convert a spreadsheet row array → plain object using column headers */
function rowToObj(cols, row) {
    const obj = {};
    cols.forEach((c, i) => { obj[c] = row[i] !== undefined ? String(row[i]) : ''; });
    return obj;
}
/** Convert a plain object → spreadsheet row array */
function objToRow(cols, obj) {
    return cols.map(c => obj[c] !== undefined ? String(obj[c]) : '');
}

/** Read all data rows from a sheet (skips header row 1) */
async function sheetGetAll(sheetName, cols) {
    const colEnd = String.fromCharCode(64 + cols.length);
    const res    = await sheetsAPI.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A2:${colEnd}`,
    });
    return (res.data.values || [])
        .filter(r => r.some(c => c !== ''))
        .map(r => rowToObj(cols, r));
}

/** Append one row to a sheet */
async function sheetAppend(sheetName, cols, obj) {
    await sheetsAPI.spreadsheets.values.append({
        spreadsheetId:   SPREADSHEET_ID,
        range:           `${sheetName}!A1`,
        valueInputOption:'RAW',
        insertDataOption:'INSERT_ROWS',
        resource: { values: [objToRow(cols, obj)] },
    });
}

/** Overwrite ALL data rows in a sheet (clear + rewrite) — used for delete/update */
async function sheetSaveAll(sheetName, cols, rows) {
    // 1. clear data area
    await sheetsAPI.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range:         `${sheetName}!A2:Z`,
    });
    if (!rows.length) return;

    // 2. rewrite all rows
    await sheetsAPI.spreadsheets.values.update({
        spreadsheetId:   SPREADSHEET_ID,
        range:           `${sheetName}!A2`,
        valueInputOption:'RAW',
        resource: { values: rows.map(r => objToRow(cols, r)) },
    });
}

/** Write column headers to row 1 of a sheet (only if row 1 is empty) */
async function ensureSheetHeaders(sheetName, cols) {
    const colEnd = String.fromCharCode(64 + cols.length);
    const res    = await sheetsAPI.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1:${colEnd}1`,
    });
    if (!res.data.values || !res.data.values[0]?.length) {
        await sheetsAPI.spreadsheets.values.update({
            spreadsheetId:   SPREADSHEET_ID,
            range:           `${sheetName}!A1`,
            valueInputOption:'RAW',
            resource: { values: [cols] },
        });
        console.log(`  📋  Headers initialised in "${sheetName}" sheet`);
    }
}

// ════ UNIFIED DATA OPERATIONS ════════════════════════════════════════════
// These functions automatically use Google Sheets when connected,
// otherwise fall back silently to local JSON files.

async function loadMessages() {
    if (googleMode) {
        try   { return await sheetGetAll('Messages', MSG_COLS); }
        catch (e) { console.error('[Sheets] loadMessages error:', e.message); }
    }
    return loadJSON(MESSAGES_FILE);
}

async function appendMessage(msg) {
    if (googleMode) {
        try   { return await sheetAppend('Messages', MSG_COLS, msg); }
        catch (e) { console.error('[Sheets] appendMessage error:', e.message); }
    }
    const msgs = loadJSON(MESSAGES_FILE);
    msgs.unshift(msg);
    saveJSON(MESSAGES_FILE, msgs);
}

async function saveMessages(msgs) {
    if (googleMode) {
        try   { return await sheetSaveAll('Messages', MSG_COLS, msgs); }
        catch (e) { console.error('[Sheets] saveMessages error:', e.message); }
    }
    saveJSON(MESSAGES_FILE, msgs);
}

async function loadUsers() {
    if (googleMode) {
        try   { return await sheetGetAll('Users', USER_COLS); }
        catch (e) { console.error('[Sheets] loadUsers error:', e.message); }
    }
    return loadJSON(USERS_FILE);
}

async function appendUser(user) {
    if (googleMode) {
        try   { return await sheetAppend('Users', USER_COLS, user); }
        catch (e) { console.error('[Sheets] appendUser error:', e.message); }
    }
    const users = loadJSON(USERS_FILE);
    users.unshift(user);
    saveJSON(USERS_FILE, users);
}

async function saveUsers(users) {
    if (googleMode) {
        try   { return await sheetSaveAll('Users', USER_COLS, users); }
        catch (e) { console.error('[Sheets] saveUsers error:', e.message); }
    }
    saveJSON(USERS_FILE, users);
}

async function loadFeedback() {
    if (googleMode) {
        try   { return await sheetGetAll('Feedback', FEEDBACK_COLS); }
        catch (e) { console.error('[Sheets] loadFeedback error:', e.message); }
    }
    return loadJSON(FEEDBACK_FILE);
}

async function appendFeedback(feedback) {
    if (googleMode) {
        try   { return await sheetAppend('Feedback', FEEDBACK_COLS, feedback); }
        catch (e) { console.error('[Sheets] appendFeedback error:', e.message); }
    }
    const feedbacks = loadJSON(FEEDBACK_FILE);
    feedbacks.unshift(feedback);
    saveJSON(FEEDBACK_FILE, feedbacks);
}

async function saveFeedback(feedbacks) {
    if (googleMode) {
        try   { return await sheetSaveAll('Feedback', FEEDBACK_COLS, feedbacks); }
        catch (e) { console.error('[Sheets] saveFeedback error:', e.message); }
    }
    saveJSON(FEEDBACK_FILE, feedbacks);
}

// ════ GOOGLE SHEETS INITIALISATION ══════════════════════════════════════
async function initGoogle() {
    // Check prerequisites
    if (!fs.existsSync(CREDS_FILE)) {
        console.log('  📁  google-credentials.json not found');
        console.log('      → Running in LOCAL JSON mode');
        console.log('      → Follow SETUP_GUIDE.md to connect Google Sheets');
        return;
    }
    if (!SPREADSHEET_ID || SPREADSHEET_ID === 'YOUR_SPREADSHEET_ID_HERE') {
        console.log('  📊  SPREADSHEET_ID not set in server.js');
        console.log('      → Running in LOCAL JSON mode');
        console.log('      → Follow SETUP_GUIDE.md to connect Google Sheets');
        return;
    }

    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: CREDS_FILE,
            scopes:  ['https://www.googleapis.com/auth/spreadsheets'],
        });
        sheetsAPI = google.sheets({ version: 'v4', auth });

        // Test connectivity
        const meta = await sheetsAPI.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        console.log(`  📊  Spreadsheet: "${meta.data.properties.title}"`);

        // Verify "Messages", "Users", and "Feedback" sheets exist
        const sheetNames = meta.data.sheets.map(s => s.properties.title);
        const missing   = ['Messages', 'Users', 'Feedback'].filter(n => !sheetNames.includes(n));
        if (missing.length) {
            throw new Error(`Missing sheets: ${missing.join(', ')}. Create them in your spreadsheet — see SETUP_GUIDE.md`);
        }

        // Ensure column headers are set
        await ensureSheetHeaders('Messages', MSG_COLS);
        await ensureSheetHeaders('Users',    USER_COLS);
        await ensureSheetHeaders('Feedback', FEEDBACK_COLS);

        googleMode = true;
        console.log('  ✅  Google Sheets database CONNECTED!');
        console.log(`  🔗  https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);

    } catch (e) {
        console.log(`  ⚠️  Google Sheets error: ${e.message}`);
        console.log('      → Falling back to LOCAL JSON mode');
        sheetsAPI  = null;
        googleMode = false;
    }
}

// ════ API ROUTES ═════════════════════════════════════════════════════════

// Status — shows which database mode is active
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        mode:    googleMode ? 'google-sheets' : 'local-json',
        label:   googleMode ? '🟢 Google Sheets' : '🟡 Local JSON',
    });
});

// ── Feedback API ─────────────────────────────────────────────────────────
app.get('/api/feedback', async (req, res) => {
    try {
        const feedbacks = await loadFeedback();
        // Default to returning only approved feedback, or if status missing assume approved
        const approved = feedbacks.filter(f => !f.status || f.status === 'approved');
        res.json({ success: true, data: approved });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/feedback', async (req, res) => {
    const { name, rating, message } = req.body;
    if (!name || !rating || !message) {
        return res.status(400).json({ success: false, error: 'Name, rating, and message are required.' });
    }
    try {
        await appendFeedback({
            id: Date.now(),
            submittedAt: nowIST(),
            name,
            rating: parseInt(rating, 10),
            message,
            status: 'approved' // Automatically approve for now
        });
        console.log(`✅ Feedback: from ${name} [${rating} stars]`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin login ──────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = generateToken();
        adminSessions.set(token, Date.now() + 8 * 60 * 60 * 1000); // 8 hrs
        return res.json({ success: true, token, mode: googleMode ? 'google-sheets' : 'local-json' });
    }
    res.status(401).json({ success: false, error: 'Invalid credentials' });
});

app.post('/api/admin/logout', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token) adminSessions.delete(token);
    res.json({ success: true });
});

// ── User register ────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
    const { username, email, password, discord } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ success: false, error: 'Username, email and password are required.' });
    }
    try {
        const users = await loadUsers();
        if (users.find(u => u.email?.toLowerCase() === email.toLowerCase()))
            return res.status(409).json({ success: false, error: 'Email already registered.' });
        if (users.find(u => u.username?.toLowerCase() === username.toLowerCase()))
            return res.status(409).json({ success: false, error: 'Username already taken.' });

        const { hash, salt } = hashPass(password);
        await appendUser({
            id: Date.now(), registeredAt: nowIST(),
            username, email, discord: discord || '',
            passwordHash: hash, salt, status: 'active',
        });
        console.log(`✅ Register: ${username} <${email}> [${googleMode ? 'Sheets' : 'Local'}]`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── User login ───────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ success: false, error: 'Email and password required.' });
    try {
        const users = await loadUsers();
        const user  = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
        if (!user || !verifyPass(password, user.salt, user.passwordHash))
            return res.status(401).json({ success: false, error: 'Invalid email or password.' });

        console.log(`✅ Login: ${user.username} [${googleMode ? 'Sheets' : 'Local'}]`);
        res.json({ success: true, user: { username: user.username, email: user.email, discord: user.discord } });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Contact form ─────────────────────────────────────────────────────────
app.post('/submit-contact', async (req, res) => {
    const { firstName, lastName, email, discord, service, message } = req.body;
    if (!firstName || !email || !service || !message)
        return res.status(400).json({ success: false, error: 'Missing required fields.' });
    try {
        await appendMessage({
            id: Date.now(), receivedAt: nowIST(),
            firstName, lastName: lastName || '', email,
            discord: discord || '', service, message, status: 'unread',
        });
        console.log(`📬 Message: ${firstName} <${email}> – ${service} [${googleMode ? 'Sheets' : 'Local'}]`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: stats ─────────────────────────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const [messages, users] = await Promise.all([loadMessages(), loadUsers()]);
        res.json({
            success:        true,
            totalMessages:  messages.length,
            unreadMessages: messages.filter(m => m.status === 'unread').length,
            totalUsers:     users.length,
            activeUsers:    users.filter(u => u.status === 'active').length,
            mode:           googleMode ? 'google-sheets' : 'local-json',
            modeLabel:      googleMode ? '🟢 Google Sheets' : '🟡 Local JSON',
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: Maintenance ───────────────────────────────────────────────────
app.get('/api/admin/maintenance', requireAdmin, (req, res) => {
    res.json({ success: true, isMaintenance });
});

app.post('/api/admin/maintenance', requireAdmin, (req, res) => {
    const { active } = req.body;
    isMaintenance = !!active;
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ isMaintenance }, null, 2));
        console.log(`🛠️ Maintenance Mode: ${isMaintenance ? 'ACTIVATED' : 'DEACTIVATED'}`);
        res.json({ success: true, isMaintenance });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: messages ───────────────────────────────────────────────────────
app.get('/api/admin/messages', requireAdmin, async (req, res) => {
    try { res.json({ success: true, messages: await loadMessages() }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: users ────────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const safe = (await loadUsers()).map(u => ({
            id: u.id, username: u.username, email: u.email,
            discord: u.discord, registeredAt: u.registeredAt, status: u.status,
        }));
        res.json({ success: true, users: safe });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: mark message as read ──────────────────────────────────────────
app.patch('/api/admin/messages/:id/read', requireAdmin, async (req, res) => {
    try {
        const id   = String(req.params.id);
        const msgs = await loadMessages();
        const idx  = msgs.findIndex(m => String(m.id) === id);
        if (idx !== -1) { msgs[idx].status = 'read'; await saveMessages(msgs); }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: delete message ────────────────────────────────────────────────
app.delete('/api/admin/messages/:id', requireAdmin, async (req, res) => {
    try {
        const id   = String(req.params.id);
        const msgs = (await loadMessages()).filter(m => String(m.id) !== id);
        await saveMessages(msgs);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Admin: delete user ────────────────────────────────────────────────────
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const id    = String(req.params.id);
        const users = (await loadUsers()).filter(u => String(u.id) !== id);
        await saveUsers(users);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Forgot Password / Reset Password ───────────────────────────────────────
function loadVerificationCodes() {
    if (!fs.existsSync(VERIFICATION_FILE)) fs.writeFileSync(VERIFICATION_FILE, '{}', 'utf-8');
    try   { return JSON.parse(fs.readFileSync(VERIFICATION_FILE, 'utf-8')); }
    catch { return {}; }
}
function saveVerificationCodes(data) {
    fs.writeFileSync(VERIFICATION_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email required.' });

    try {
        const users = await loadUsers();
        const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
        if (!user) {
            // For security, do not reveal if email exists, just pretend it succeeded
            return res.json({ success: true, message: 'If an account exists, a reset code was sent.' });
        }

        // Generate 6 digit code
        const code = crypto.randomInt(100000, 999999).toString();
        
        // Save code with 15 min expiration
        const codes = loadVerificationCodes();
        codes[email.toLowerCase()] = {
            code,
            expiresAt: Date.now() + 15 * 60 * 1000 // 15 mins
        };
        saveVerificationCodes(codes);

        // Send Email
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            await transporter.sendMail({
                from: `"SicKloT Support" <${process.env.SMTP_USER}>`,
                to: email,
                subject: 'Your SicKloT Password Reset Code',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                        <h2 style="color: #0055ff; margin-bottom: 20px;">Password Reset Request</h2>
                        <p>Hi ${user.username},</p>
                        <p>We received a request to reset your SicKloT password. Your verification code is:</p>
                        <div style="background: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333; border-radius: 8px; margin: 20px 0;">
                            ${code}
                        </div>
                        <p style="color: #666; font-size: 14px;">This code will expire in 15 minutes.</p>
                        <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
                        <div style="margin-top: 30px; font-size: 12px; color: #999; text-align: center;">
                            &copy; 2026 SicKloT Development Group.
                        </div>
                    </div>
                `
            });
            console.log(`✉️ Reset Code sent to: ${email}`);
        } else {
            console.log(`⚠️ SMTP NOT CONFIGURED: Code for ${email} is ${code}`);
        }

        res.json({ success: true, message: 'If an account exists, a reset code was sent.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: 'Failed to process request.' });
    }
});

app.post('/api/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
        return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }

    try {
        const emailLower = email.toLowerCase();
        const codes = loadVerificationCodes();
        const record = codes[emailLower];

        if (!record || record.code !== code) {
            return res.status(400).json({ success: false, error: 'Invalid or incorrect verification code.' });
        }
        if (Date.now() > record.expiresAt) {
            delete codes[emailLower];
            saveVerificationCodes(codes);
            return res.status(400).json({ success: false, error: 'Verification code has expired. Please request a new one.' });
        }

        // Code is valid. Update user password.
        const users = await loadUsers();
        let userUpdated = false;

        const updatedUsers = users.map(u => {
            if (u.email?.toLowerCase() === emailLower) {
                const { hash, salt } = hashPass(newPassword);
                u.passwordHash = hash;
                u.salt = salt;
                userUpdated = true;
            }
            return u;
        });

        if (!userUpdated) {
            return res.status(404).json({ success: false, error: 'Account not found.' });
        }

        // Save users
        await saveUsers(updatedUsers);

        // Delete code
        delete codes[emailLower];
        saveVerificationCodes(codes);

        console.log(`🔑 Password reset successful for: ${email}`);
        res.json({ success: true, message: 'Password has been reset successfully.' });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: 'Failed to reset password.' });
    }
});

// Export
app.get('/messages/export', (req, res) => res.download(MESSAGES_FILE, 'siklot-messages.json'));

// ════ START ══════════════════════════════════════════════════════════════
(async () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║   SicKloT Server  🚀  v3.0                   ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');

    // Try to connect to Google Sheets
    await initGoogle();

    console.log('');
    app.listen(PORT, () => {
        console.log(`  🌐  Website  →  http://localhost:${PORT}`);
        console.log(`  🔐  Admin    →  http://localhost:${PORT}/admin.html`);
        console.log(`  👤  Login    →  http://localhost:${PORT}/login.html`);
        console.log(`  📋  Signup   →  http://localhost:${PORT}/signup.html`);
        console.log(`  💾  Database →  ${googleMode ? '🟢 Google Sheets (live)' : '🟡 Local JSON (see SETUP_GUIDE.md)'}`);
        console.log('');
    });
})();
