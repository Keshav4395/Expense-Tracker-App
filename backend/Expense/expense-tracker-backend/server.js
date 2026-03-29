// backend/server.js
// Full server.js with fixes:
// - Removed app.options('/*', ...) which caused path-to-regexp errors
// - Replaced with OPTIONS preflight middleware to avoid path parsing issues
// - Lightweight in-file rate limiter (no external express-rate-limit dependency)
// - CORS configured with credentials and FRONTEND_ORIGIN
// - cookie-parser enabled for refresh token cookie
// - Refresh token issuance, /auth/refresh, /auth/logout implemented
// - crypto.randomInt for OTPs, OTP logs gated by NODE_ENV
// - express.json() used
// - async CSV writes with proper quoting and centralized generateCSV
// - Python binary detected once at startup (no spawnSync per request inside handlers)
// - OTP cleanup implemented (node-cron optional, fallback setInterval)
// - Nodemailer transporter with console fallback retained
// - Minimal safe defaults and better logging

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
let cron = null;
try { cron = require('node-cron'); } catch (e) { /* optional */ }

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Optional middleware (if installed) - non-fatal if absent
try {
  const helmet = require('helmet');
  app.use(helmet());
} catch (e) {
  console.warn('Optional dependency "helmet" not found — skipping. Install it for improved security headers.');
}
try {
  const morgan = require('morgan');
  if (NODE_ENV === 'development') app.use(morgan('dev'));
} catch (e) { /* optional */ }

// -------------------- Middleware --------------------
app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Global OPTIONS preflight responder (avoids using path wildcards that some path-to-regexp versions reject)
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    // Add any additional allowed methods/headers as needed
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.sendStatus(200);
  }
  next();
});

// -------------------- In-memory stores (dev only) --------------------
let users = []; // { userId, email, password (hashed), phone, twoFAMethod, profile, verified, createdAt }
let expenses = []; // expense objects
const otpStore = new Map(); // email -> { otp, expiry, password, phone, twoFAMethod, isSignup, attempts }
const mlStore = new Map(); // userId -> analysis cache
const refreshTokenStore = new Map(); // refreshToken -> { userId, createdAt }

// -------------------- Helpers --------------------
function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function safeDate(v) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date() : d;
}
function csvEscape(v = '') {
  return `"${String(v).replace(/"/g, '""')}"`;
}
function generateCSV(userId, expense) {
  const date = expense.date;
  const description = csvEscape(expense.description || '');
  const category = csvEscape(expense.category || 'Unknown');
  const amount = toNumber(expense.totalExpense || expense.amount || 0, 0);
  return `${csvEscape(userId)},${csvEscape(date)},${description},${category},${amount},${amount}\n`;
}

// -------------------- Email transporter (robust) --------------------
function createEmailTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASSWORD;

  if (!user || !pass) {
    console.warn('EMAIL_USER or EMAIL_PASSWORD not set. Using console fallback for emails.');
    return {
      sendMail: async (mailOptions) => {
        console.log('--- EMAIL (console fallback) ---');
        console.log(JSON.stringify(mailOptions, null, 2));
        return Promise.resolve({ accepted: [mailOptions.to] });
      },
      verify: (cb) => cb && cb(null, true)
    };
  }

  const t587 = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });

  return t587;
}

let transporter = createEmailTransporter();

transporter.verify((err) => {
  if (err) {
    console.error('Email verification failed (587):', err && err.message ? err.message : err);
    // Try 465 fallback
    if (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
      try {
        const t465 = nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: 465,
          secure: true,
          auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
        });
        t465.verify((err2) => {
          if (err2) {
            console.error('Email verification failed (465):', err2 && err2.message ? err2.message : err2);
            console.warn('Emails will be logged to console until SMTP is fixed.');
            transporter = {
              sendMail: async (mailOptions) => {
                console.log('--- EMAIL (console fallback) ---');
                console.log(JSON.stringify(mailOptions, null, 2));
                return Promise.resolve({ accepted: [mailOptions.to] });
              },
              verify: (cb) => cb && cb(null, true)
            };
          } else {
            transporter = t465;
            console.log('Email server (465) is ready to send messages');
          }
        });
      } catch (e) {
        console.error('Fallback 465 check error:', e);
        transporter = {
          sendMail: async (mailOptions) => {
            console.log('--- EMAIL (console fallback) ---');
            console.log(JSON.stringify(mailOptions, null, 2));
            return Promise.resolve({ accepted: [mailOptions.to] });
          },
          verify: (cb) => cb && cb(null, true)
        };
      }
    }
  } else {
    console.log('Email server (587) is ready to send messages');
  }
});

async function sendMailSafe(mailOptions) {
  try {
    return await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error('sendMailSafe error:', err);
    throw err;
  }
}

// -------------------- OTP and tokens --------------------
function generateOTP() {
  const n = crypto.randomInt(100000, 1000000);
  return String(n);
}

async function sendOTPEmail(email, otp, isSignup = true) {
  const mailOptions = {
    from: `ExpenseAI <${process.env.EMAIL_USER || 'noreply@example.com'}>`,
    to: email,
    subject: isSignup ? 'ExpenseAI - Verify Your Account' : 'ExpenseAI - Login Verification',
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"/></head>
      <body style="font-family: Arial, sans-serif; background:#000; color:#fff; padding:20px">
        <div style="max-width:600px;margin:0 auto;background:#1a1a1a;padding:30px;border-radius:12px;">
          <h2>${isSignup ? 'Welcome to ExpenseAI!' : 'Login Verification'}</h2>
          <p>Your verification code is:</p>
          <div style="background:#fff;color:#000;padding:18px;border-radius:8px;text-align:center;font-size:32px;font-weight:700;letter-spacing:6px;">${otp}</div>
          <p>This code will expire in <strong>10 minutes</strong>.</p>
          <p>If you didn't request this code, please ignore this email.</p>
        </div>
      </body>
      </html>
    `
  };

  try {
    await sendMailSafe(mailOptions);
    if (NODE_ENV === 'development') {
      console.log(`OTP sent to ${email}: ${otp}`);
    } else {
      console.log(`OTP sent to ${email}`);
    }
    return true;
  } catch (error) {
    console.error('Email send error:', error);
    return false;
  }
}

// JWT helpers
const ACCESS_TOKEN_EXPIRES = process.env.ACCESS_TOKEN_EXPIRES || '15m';
const REFRESH_TOKEN_EXPIRES_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30);

function createTokens(user) {
  const accessToken = jwt.sign(
    { userId: user.userId, email: user.email },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: ACCESS_TOKEN_EXPIRES }
  );
  const refreshToken = jwt.sign(
    { userId: user.userId, email: user.email },
    process.env.REFRESH_TOKEN_SECRET || (process.env.JWT_SECRET || 'your-secret-key') + '_refresh',
    { expiresIn: `${REFRESH_TOKEN_EXPIRES_DAYS}d` }
  );
  refreshTokenStore.set(refreshToken, { userId: user.userId, createdAt: Date.now() });
  return { accessToken, refreshToken };
}

// -------------------- Simple in-file rate limiter --------------------
const simpleRateLimits = new Map(); // key -> { count, firstTs }
function simpleRateLimiter({ windowMs = 15 * 60 * 1000, max = 12 } = {}) {
  return (req, res, next) => {
    try {
      const key = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'global';
      const now = Date.now();
      const entry = simpleRateLimits.get(key) || { count: 0, firstTs: now };
      if (now - entry.firstTs > windowMs) {
        entry.count = 1;
        entry.firstTs = now;
      } else {
        entry.count += 1;
      }
      simpleRateLimits.set(key, entry);
      if (entry.count > max) {
        return res.status(429).json({ error: 'Too many requests, please try again later.' });
      }
      next();
    } catch (e) {
      next();
    }
  };
}

const authLimiter = simpleRateLimiter({ windowMs: 15 * 60 * 1000, max: 12 });
const analyzeNoAuthLimiter = simpleRateLimiter({ windowMs: 60 * 1000, max: 6 });

// -------------------- Auth routes --------------------
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  try {
    const { email, password, phone, twoFAMethod } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const existingUser = users.find(u => u.email === email);
    if (existingUser) return res.status(400).json({ error: 'User already exists' });

    const otp = generateOTP();
    const otpExpiry = Date.now() + 10 * 60 * 1000;
    const hashedPassword = await bcrypt.hash(password, 10);

    otpStore.set(email, { otp, expiry: otpExpiry, password: hashedPassword, phone, twoFAMethod, isSignup: true, attempts: 0 });
    const emailSent = await sendOTPEmail(email, otp, true);
    if (!emailSent) return res.status(500).json({ error: 'Failed to send OTP. Please check email configuration.' });

    res.json({ message: 'OTP sent to your email', email });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const user = users.find(u => u.email === email);
    if (!user) return res.status(400).json({ error: 'User not found' });

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) return res.status(400).json({ error: 'Invalid password' });

    const otp = generateOTP();
    const otpExpiry = Date.now() + 10 * 60 * 1000;
    otpStore.set(email, { otp, expiry: otpExpiry, isSignup: false, attempts: 0 });
    const emailSent = await sendOTPEmail(email, otp, false);
    if (!emailSent) return res.status(500).json({ error: 'Failed to send OTP' });

    res.json({ message: 'OTP sent to your email', email });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// VERIFY OTP
app.post('/api/auth/verify-otp', authLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ error: 'email and otp are required' });

    if (!otpStore.has(email)) return res.status(400).json({ error: 'OTP not found or expired' });

    const stored = otpStore.get(email);

    stored.attempts = (stored.attempts || 0) + 1;
    if (stored.attempts > 8) {
      otpStore.delete(email);
      return res.status(429).json({ error: 'Too many attempts. Please request a new OTP.' });
    }

    if (Date.now() > stored.expiry) {
      otpStore.delete(email);
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }

    if (String(stored.otp) !== String(otp)) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Signup flow: create user
    if (stored.isSignup) {
      const existing = users.find(u => u.email === email);
      if (!existing) {
        const newUser = {
          userId: `user_${Date.now()}`,
          email,
          password: stored.password, // already hashed
          phone: stored.phone,
          twoFAMethod: stored.twoFAMethod,
          verified: true,
          createdAt: new Date()
        };
        users.push(newUser);
      } else {
        existing.verified = true;
      }
    }

    const user = users.find(u => u.email === email);
    if (!user) {
      console.error('verify-otp: user not found after OTP flow', email);
      return res.status(500).json({ error: 'User not found after verification' });
    }

    const { accessToken, refreshToken } = createTokens(user);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000
    });

    otpStore.delete(email);

    return res.json({ message: 'Verified successfully', token: accessToken, userId: user.userId, email: user.email });
  } catch (error) {
    console.error('verify-otp: unexpected error', error);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

app.post('/api/auth/resend-otp', authLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });

    if (!otpStore.has(email)) return res.status(400).json({ error: 'No pending verification for this email' });

    const stored = otpStore.get(email);
    const otp = generateOTP();
    const otpExpiry = Date.now() + 10 * 60 * 1000;
    otpStore.set(email, { ...stored, otp, expiry: otpExpiry, attempts: 0 });
    const emailSent = await sendOTPEmail(email, otp, stored.isSignup);
    if (!emailSent) return res.status(500).json({ error: 'Failed to resend OTP' });

    res.json({ message: 'New OTP sent to your email' });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

// -------------------- Refresh & Logout endpoints --------------------
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return res.status(401).json({ error: 'No refresh token' });

    if (!refreshTokenStore.has(token)) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    try {
      const decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET || (process.env.JWT_SECRET || 'your-secret-key') + '_refresh');
      const user = users.find(u => u.userId === decoded.userId);
      if (!user) {
        refreshTokenStore.delete(token);
        return res.status(401).json({ error: 'User not found' });
      }

      const accessToken = jwt.sign({ userId: user.userId, email: user.email }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: ACCESS_TOKEN_EXPIRES });
      return res.json({ token: accessToken });
    } catch (err) {
      refreshTokenStore.delete(token);
      res.clearCookie('refreshToken', { httpOnly: true, sameSite: 'lax', secure: NODE_ENV === 'production' });
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
  } catch (err) {
    console.error('Refresh error', err);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (token && refreshTokenStore.has(token)) refreshTokenStore.delete(token);
    res.clearCookie('refreshToken', { httpOnly: true, sameSite: 'lax', secure: NODE_ENV === 'production' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Logout error', err);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// -------------------- Token middleware --------------------
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// -------------------- User profile --------------------
app.post('/api/users/onboarding', verifyToken, (req, res) => {
  try {
    const { userId, userType, monthlyIncome, targetSavings, dailyBudget, reminderTime } = req.body || {};
    if (req.user.userId !== userId) return res.status(403).json({ error: 'Unauthorized' });
    const user = users.find(u => u.userId === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.profile = { userType, monthlyIncome, targetSavings, dailyBudget, reminderTime, onboardingComplete: true };
    res.json({ message: 'Profile updated', user: { ...user, password: undefined } });
  } catch (err) {
    console.error('Onboarding error:', err);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

app.get('/api/users/me', verifyToken, (req, res) => {
  try {
    const user = users.find(u => u.userId === req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password, ...safeUser } = user;
    res.json(safeUser);
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// -------------------- Expenses --------------------
// Detect python binary once at startup
let pythonBin = 'python3';
try {
  const check = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  if (check.error) throw check.error;
  pythonBin = 'python3';
} catch (e) {
  pythonBin = 'python';
}
console.log(`Using python binary: ${pythonBin}`);

app.post('/api/expenses/add', verifyToken, async (req, res) => {
  try {
    const { userId, date, description = '', category = '', amount, totalExpense, categories } = req.body || {};
    if (req.user.userId !== userId) return res.status(403).json({ error: 'Unauthorized' });

    const normalizedTotal = toNumber(totalExpense || amount || 0, 0);
    const expense = {
      expenseId: `exp_${Date.now()}`,
      userId,
      date: safeDate(date).toISOString().split('T')[0],
      description,
      category,
      amount: normalizedTotal,
      categories: categories || null,
      totalExpense: normalizedTotal,
      createdAt: new Date().toISOString()
    };

    expenses.push(expense);

    // Ensure data dir exists and write CSV reliably (async)
    const csvDir = path.join(__dirname, 'data');
    const csvPath = path.join(csvDir, `${userId}_expenses.csv`);
    try {
      await fs.promises.mkdir(csvDir, { recursive: true });
      const header = 'userId,date,description,category,amount,totalExpense\n';
      try {
        await fs.promises.access(csvPath, fs.constants.F_OK);
      } catch {
        await fs.promises.writeFile(csvPath, header, { encoding: 'utf8' });
      }
      const row = generateCSV(userId, expense);
      await fs.promises.appendFile(csvPath, row, { encoding: 'utf8' });
    } catch (e) {
      console.error('CSV write error:', e);
    }

    // Calculate budget status and simple ML update
    const user = users.find(u => u.userId === userId);
    const userExpenses = expenses.filter(e => e.userId === userId);
    const budgetStatus = calculateBudgetStatus(user, userExpenses);

    // Spawn Python analyzer asynchronously (if present)
    (async () => {
      try {
        const pyScript = path.join(__dirname, 'data', 'analyze_cli.py');
        if (!fs.existsSync(pyScript)) {
          return;
        }

        const args = [
          pyScript,
          '--csv', path.join(__dirname, 'data', `${userId}_expenses.csv`),
          '--userId', userId,
          '--monthlyIncome', String(user?.profile?.monthlyIncome || 0),
          '--targetSavings', String(user?.profile?.targetSavings || 0),
          '--dailyBudget', String(user?.profile?.dailyBudget || 0)
        ];

        const py = spawn(pythonBin, args, { cwd: __dirname });

        let stdout = '';
        let stderr = '';

        py.stdout.on('data', (data) => { stdout += data.toString(); });
        py.stderr.on('data', (data) => { stderr += data.toString(); });

        py.on('close', (code) => {
          if (stderr) console.error('analyzer stderr:', stderr);
          if (!stdout) {
            console.log('analyzer finished with no output, code=', code);
            return;
          }
          try {
            const parsed = JSON.parse(stdout);
            if (!parsed.error) {
              mlStore.set(userId, parsed);
              console.log(`ML analysis updated for ${userId}`);
            } else {
              console.warn('analyzer returned error:', parsed);
              try {
                const analysisFile = path.join(__dirname, 'data', `${userId}_analysis.json`);
                if (fs.existsSync(analysisFile)) {
                  const fileData = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));
                  mlStore.set(userId, fileData);
                  console.log(`ML analysis loaded from file for ${userId}`);
                }
              } catch (e) {
                console.error('Fallback load analysis file failed:', e);
              }
            }
          } catch (e) {
            console.error('Failed parsing analyzer output:', e, stdout);
          }
        });

        py.on('error', (err) => {
          console.error('Failed to start analyzer script:', err);
        });
      } catch (err) {
        console.error('Failed to spawn analyzer:', err);
      }
    })();

    res.json({ message: 'Expense added', expense, budgetStatus, mlMessage: mlStore.get(userId) ? 'AI insights updated' : undefined });
  } catch (err) {
    console.error('Add expense error:', err);
    res.status(500).json({ error: 'Failed to add expense' });
  }
});

app.get('/api/expenses/:userId', verifyToken, (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.userId !== userId) return res.status(403).json({ error: 'Unauthorized' });
    const userExpenses = expenses.filter(e => e.userId === userId);
    const user = users.find(u => u.userId === userId);
    const budgetStatus = calculateBudgetStatus(user, userExpenses);
    res.json({ expenses: userExpenses, budgetStatus });
  } catch (err) {
    console.error('Get expenses error:', err);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// -------------------- Budget calc & ML stubs --------------------
function calculateBudgetStatus(user, userExpenses) {
  if (!user || !user.profile) return null;
  const monthlyIncome = toNumber(user.profile.monthlyIncome, 0);
  const targetSavings = toNumber(user.profile.targetSavings, 0);
  const dailyBudget = toNumber(user.profile.dailyBudget, 0);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthlyExpenses = (userExpenses || []).filter(e => {
    const expDate = safeDate(e.date);
    return expDate.getMonth() === currentMonth && expDate.getFullYear() === currentYear;
  });
  const totalSpent = monthlyExpenses.reduce((sum, e) => sum + toNumber(e.totalExpense || e.amount || 0), 0);
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const daysRemaining = Math.max(daysInMonth - dayOfMonth, 0);
  const availableBudget = monthlyIncome - targetSavings;
  const remainingBudget = availableBudget - totalSpent;
  const budgetPerRemainingDay = daysRemaining > 0 ? remainingBudget / daysRemaining : 0;
  const spendingRate = availableBudget > 0 ? totalSpent / availableBudget : 0;
  const timeRate = dayOfMonth / daysInMonth;

  let riskLevel = 'Low';
  if (spendingRate > timeRate + 0.15) riskLevel = 'High';
  else if (spendingRate > timeRate) riskLevel = 'Medium';

  const recommendations = [];
  if (riskLevel === 'High') recommendations.push('🚨 URGENT: You are overspending! Cut non-essential expenses');
  if (budgetPerRemainingDay < dailyBudget * 0.5) recommendations.push(`⚠️ Only ₹${Math.floor(budgetPerRemainingDay)}/day left for ${daysRemaining} days`);
  if (totalSpent < availableBudget && riskLevel === 'Low') recommendations.push('✅ Great job! You are on track to meet your savings goal');

  return {
    monthlyIncome,
    targetSavings,
    availableBudget,
    totalSpent,
    remainingBudget,
    dayOfMonth,
    daysRemaining,
    dailyBudget,
    budgetPerRemainingDay: Math.floor(budgetPerRemainingDay),
    riskLevel,
    recommendations,
    onTrack: remainingBudget >= 0
  };
}

// -------------------- ML endpoints --------------------
app.get('/api/ml/health', (req, res) => res.json({ status: 'connected' }));

app.get('/api/ml/results/:userId', verifyToken, (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.userId !== userId) return res.status(403).json({ error: 'Unauthorized' });

    const cached = mlStore.get(userId);
    if (cached) return res.json(cached);

    const analysisFile = path.join(__dirname, 'data', `${userId}_analysis.json`);
    if (fs.existsSync(analysisFile)) {
      try {
        const fileData = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));
        mlStore.set(userId, fileData);
        return res.json(fileData);
      } catch (e) {
        console.error('Failed to parse analysis file:', e);
      }
    }

    const userExpenses = expenses.filter(e => e.userId === userId);
    const user = users.find(u => u.userId === userId);
    const analysis = simpleMLAnalysis(user, userExpenses);
    mlStore.set(userId, analysis);
    res.json(analysis);
  } catch (err) {
    console.error('ML results error:', err);
    res.status(500).json({ error: 'Failed to fetch ML results' });
  }
});

app.post('/api/ml/analyze/:userId', verifyToken, (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.userId !== userId) return res.status(403).json({ error: 'Unauthorized' });
    const userExpenses = expenses.filter(e => e.userId === userId);
    const user = users.find(u => u.userId === userId);
    const analysis = simpleMLAnalysis(user, userExpenses);
    mlStore.set(userId, analysis);
    res.json({ analysis });
  } catch (err) {
    console.error('ML analyze error:', err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

app.post('/api/ml/analyze', analyzeNoAuthLimiter, (req, res) => {
  try {
    const payload = req.body || {};
    const userId = payload.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const userExpenses = expenses.filter(e => e.userId === userId);
    const user = users.find(u => u.userId === userId);
    const analysis = simpleMLAnalysis(user, userExpenses);
    mlStore.set(userId, analysis);
    res.json({ analysis });
  } catch (err) {
    console.error('ML analyze (no-auth) error:', err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// -------------------- simple fallback analysis --------------------
function simpleMLAnalysis(user, userExpenses) {
  const lastNDays = 14;
  const now = new Date();
  const cutoff = new Date(now.getTime() - lastNDays * 24 * 60 * 60 * 1000);

  const recent = (userExpenses || []).filter(e => new Date(e.date) >= cutoff);
  const daysAnalyzed = Math.max(1, Math.min(lastNDays, recent.length || 1));
  const totalSpent = recent.reduce((s, e) => s + toNumber(e.totalExpense || e.amount || 0), 0);
  const avgDaily = totalSpent / daysAnalyzed;

  const catTotals = {};
  recent.forEach(e => {
    const cat = e.category || 'Unknown';
    catTotals[cat] = (catTotals[cat] || 0) + toNumber(e.totalExpense || e.amount || 0);
  });
  const topCategory = Object.entries(catTotals).sort((a,b) => b[1]-a[1])[0]?.[0] || null;

  const monthlyIncome = user?.profile ? toNumber(user.profile.monthlyIncome, 0) : 0;
  const baselineDaily = monthlyIncome ? monthlyIncome / 30 : 0;
  let predicted_behavior = 'balanced_spender';
  if (avgDaily > baselineDaily * 0.8) predicted_behavior = 'high_spender';
  else if (avgDaily < baselineDaily * 0.4) predicted_behavior = 'frugal_spender';

  const confidence = Math.min(95, 50 + (recent.length * 5));

  return {
    analysis_period: { days_analyzed: daysAnalyzed },
    behavior_prediction: {
      predicted_behavior,
      confidence,
      top_3_predictions: [
        { behavior: predicted_behavior, confidence }
      ]
    },
    spending_analysis: {
      total_spent: totalSpent,
      avg_daily_expense: avgDaily,
      spending_trend: avgDaily > baselineDaily ? 'increasing' : (avgDaily < baselineDaily ? 'decreasing' : 'stable'),
      top_spending_category: topCategory
    },
    recommendations: [
      ...(predicted_behavior === 'high_spender' ? ['Reduce dining out', 'Review subscriptions'] : []),
      `Review ${topCategory || 'your top category'} spending`
    ],
    analyzedAt: new Date().toISOString()
  };
}

// -------------------- Optional test email endpoint --------------------
app.post('/internal/test-email', async (req, res) => {
  const to = req.body.to || process.env.EMAIL_TEST_RECIPIENT || process.env.EMAIL_USER;
  try {
    await sendMailSafe({ from: `ExpenseAI <${process.env.EMAIL_USER || 'noreply@example.com'}>`, to, subject: 'ExpenseAI test email', text: 'This is a test email from ExpenseAI server' });
    res.json({ ok: true, to });
  } catch (err) {
    console.error('Test email error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// -------------------- OTP cleanup --------------------
function cleanupExpiredOtps() {
  const now = Date.now();
  for (const [email, data] of otpStore.entries()) {
    if (data.expiry && now > data.expiry) {
      otpStore.delete(email);
      if (NODE_ENV === 'development') console.log(`Cleaned expired OTP for ${email}`);
    }
  }
}
if (cron && typeof cron.schedule === 'function') {
  cron.schedule('*/5 * * * *', () => cleanupExpiredOtps());
} else {
  setInterval(cleanupExpiredOtps, 5 * 60 * 1000);
}

// -------------------- Start server --------------------
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Frontend origin: ${FRONTEND_ORIGIN}`);
  console.log(`Email configured: ${process.env.EMAIL_USER ? 'yes' : 'no'}`);
});