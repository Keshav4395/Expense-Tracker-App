import React, { useState, useEffect, useRef } from 'react';
import {
  TrendingUp, Brain, Shield, Target, Mail, Lock, Eye, EyeOff, Check, ArrowRight, ArrowLeft,
  Briefcase, GraduationCap, Bell, Zap, PieChart, Calendar, Plus, BarChart3, Home, FileText, LogOut,
  Download, Upload, Search, Filter, Edit2, Trash2, X, Save, BarChart
} from 'lucide-react';
import { Chart as ChartJS } from 'chart.js/auto';
import { Line, Bar, Pie } from 'react-chartjs-2';
import ReportsPage from './components/ReportPage';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const safeLocalStorage = {
  getItem(key) {
    try { return (typeof window !== 'undefined' && window.localStorage) ? window.localStorage.getItem(key) : null; } catch (e) { console.warn('localStorage.getItem failed', e); return null; }
  },
  setItem(key, value) {
    try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(key, value); } catch (e) { console.warn('localStorage.setItem failed', e); }
  },
  removeItem(key) {
    try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(key); } catch (e) { console.warn('localStorage.removeItem failed', e); }
  }
};

function App() {
  const [currentPage, setCurrentPage] = useState('landing');
  const [userData, setUserData] = useState({});
  const [expenses, setExpenses] = useState([]);
  const [token, setToken] = useState(() => safeLocalStorage.getItem('token') || null);

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    const savedToken = safeLocalStorage.getItem('token');
    if (savedToken) {
      setToken(savedToken);
      verifyTokenAndFetchUser(savedToken);
    } else {
      attemptRefresh();
    }
  }, []);

  const attemptRefresh = async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          safeLocalStorage.setItem('token', data.token);
          setToken(data.token);
          verifyTokenAndFetchUser(data.token);
        }
      } else {
        safeLocalStorage.removeItem('token');
        setToken(null);
        setCurrentPage('landing');
      }
    } catch (err) {
      console.error('Refresh failed', err);
      safeLocalStorage.removeItem('token');
      setToken(null);
      setCurrentPage('landing');
    }
  };

  const verifyTokenAndFetchUser = async (tkn) => {
    try {
      const res = await fetch(`${API_URL}/users/me`, {
        headers: { Authorization: `Bearer ${tkn}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUserData(data);
        setToken(tkn);
        if (data.profile && data.profile.onboardingComplete) setCurrentPage('dashboard');
        else setCurrentPage('onboarding');
      } else {
        const refreshed = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (refreshed.ok) {
          const d = await refreshed.json();
          if (d.token) {
            safeLocalStorage.setItem('token', d.token);
            setToken(d.token);
            verifyTokenAndFetchUser(d.token);
            return;
          }
        }
        safeLocalStorage.removeItem('token');
        setToken(null);
        setCurrentPage('landing');
      }
    } catch (error) {
      console.error('Token verification failed:', error);
      safeLocalStorage.removeItem('token');
      setToken(null);
      setCurrentPage('landing');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (e) {
      console.error('Logout request failed:', e);
    } finally {
      safeLocalStorage.removeItem('token');
      setToken(null);
      setUserData({});
      setExpenses([]);
      setCurrentPage('landing');
    }
  };

  const refreshExpenses = async () => {
    if (!userData.userId || !token) return;
    try {
      const res = await fetch(`${API_URL}/expenses/${userData.userId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setExpenses(data.expenses || []);
      }
    } catch (err) {
      console.error('Failed to refresh expenses', err);
    }
  };

  const handleExportPDF = async (options = { keepOnServer: false, allTime: true }) => {
    if (!userData.userId || !token) {
      alert('Please sign in to export reports.');
      return;
    }
    setIsExporting(true);
    try {
      const payload = { userId: userData.userId, allTime: !!options.allTime };
      const res = await fetch(`${API_URL}/reports/export-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(`Export failed: ${errData.error || res.statusText}`);
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ExpenseAI_Report_${userData.email || userData.userId}_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      alert('✅ Report downloaded successfully!');
    } catch (err) {
      console.error('Export PDF error:', err);
      alert('❌ Failed to export PDF. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const triggerFileSelect = () => {
    if (!userData.userId || !token) {
      alert('Please sign in to import expenses.');
      return;
    }
    if (fileInputRef.current) fileInputRef.current.click();
  };

  // Improved file handler: sends credentials and displays actionable error when server missing multer
  const handleFileSelected = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    setImportMessage('');
    const allowed = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream'
    ];
    if (!allowed.includes(file.type) && !file.name.toLowerCase().endsWith('.csv') && !file.name.toLowerCase().match(/\.xls[x]?$/)) {
      setImportMessage('Please upload a CSV or Excel file.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setImportMessage('File too large (max 10MB).');
      return;
    }

    setIsImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('userId', userData.userId);

      const res = await fetch(`${API_URL}/expenses/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });

      if (res.status === 501) {
        setImportMessage('Server missing file upload support (multer). Please run: npm i multer on the server.');
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setImportMessage(`Imported ${data.importedCount || 0} expenses. ${data.errors?.length ? `Warnings: ${data.errors.length}` : ''}`);
        await refreshExpenses();
      } else {
        setImportMessage(`Import failed: ${data.error || res.statusText}`);
      }
    } catch (err) {
      console.error('Import error:', err);
      setImportMessage('Import failed due to network/server error.');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="bg-black min-h-screen">
      <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileSelected} className="hidden" />

      {currentPage === 'landing' && <LandingPage onSignIn={() => setCurrentPage('auth')} />}

      {currentPage === 'auth' && (
        <AuthPage
          onAuthSuccess={(res) => {
            const serverToken = res?.token || null;
            const serverUser = res?.user || null;

            if (serverToken) {
              safeLocalStorage.setItem('token', serverToken);
              setToken(serverToken);
            }

            if (serverUser) {
              setUserData(serverUser);
              if (serverUser.profile && serverUser.profile.onboardingComplete) setCurrentPage('dashboard');
              else setCurrentPage('onboarding');
            } else if (serverToken) {
              verifyTokenAndFetchUser(serverToken);
            } else {
              setCurrentPage('landing');
            }
          }}
          onBack={() => setCurrentPage('landing')}
        />
      )}

      {currentPage === 'onboarding' && (
        <OnboardingFlow
          userData={userData}
          token={token}
          onComplete={(profile) => {
            setUserData(prev => ({ ...prev, profile: { ...profile, onboardingComplete: true } }));
            setCurrentPage('dashboard');
          }}
        />
      )}

      {currentPage === 'dashboard' && (
        <Dashboard
          userData={userData}
          setUserData={setUserData}
          expenses={expenses}
          setExpenses={setExpenses}
          token={token}
          onAddExpense={() => setCurrentPage('addExpense')}
          onViewExpenses={() => setCurrentPage('expenses')}
          onViewAnalytics={() => setCurrentPage('analytics')}
          onViewReports={() => setCurrentPage('reports')}
          onViewAI={() => setCurrentPage('analysis')}
          onViewDailyReport={() => setCurrentPage('dailyReport')}
          onLogout={handleLogout}
          onExportPDF={handleExportPDF}
          onImportClick={triggerFileSelect}
          isExporting={isExporting}
          isImporting={isImporting}
          importMessage={importMessage}
          fileInputRef={fileInputRef}
          onFileSelected={handleFileSelected}
        />
      )}

      {currentPage === 'addExpense' && (
        <AddExpensePage
          userData={userData}
          token={token}
          onExpenseAdded={(expense) => {
            setExpenses(prev => [...prev, expense]);
            setCurrentPage('dashboard');
          }}
          onBack={() => setCurrentPage('dashboard')}
        />
      )}

      {currentPage === 'expenses' && (
        <ExpensesPage
          userData={userData}
          token={token}
          expenses={expenses}
          setExpenses={setExpenses}
          onBack={() => setCurrentPage('dashboard')}
          refreshExpenses={refreshExpenses}
        />
      )}

      {currentPage === 'analytics' && (
        <AnalyticsPage
          expenses={expenses}
          onBack={() => setCurrentPage('dashboard')}
        />
      )}

      {currentPage === 'reports' && (
        <ReportsPage
          userData={userData}
          expenses={expenses}
          onBack={() => setCurrentPage('dashboard')}
          token={token}
          onExportPDF={handleExportPDF}
          onImportClick={triggerFileSelect}
          isExporting={isExporting}
          isImporting={isImporting}
          importMessage={importMessage}
        />
      )}

      {currentPage === 'dailyReport' && (
        <DailyReportPage
          expenses={expenses}
          onBack={() => setCurrentPage('dashboard')}
        />
      )}

      {currentPage === 'analysis' && (
        <AIAnalysisPage
          userData={userData}
          token={token}
          expenses={expenses}
          onBack={() => setCurrentPage('dashboard')}
        />
      )}
    </div>
  );
}

// ===================== LANDING PAGE =====================
const LandingPage = ({ onSignIn }) => (
  <div className="min-h-screen bg-black text-white">
    <nav className="fixed top-0 w-full bg-black/80 backdrop-blur-xl border-b border-white/10 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-white p-2 rounded-xl">
            <TrendingUp className="w-6 h-6 text-black" />
          </div>
          <span className="text-2xl font-bold">ExpenseAI</span>
        </div>
        <button onClick={onSignIn} className="bg-white text-black px-6 py-2.5 rounded-full font-semibold hover:bg-gray-200">
          Sign In
        </button>
      </div>
    </nav>

    <div className="pt-32 pb-20 px-6">
      <div className="max-w-7xl mx-auto text-center">
        <div className="inline-block mb-6 bg-white/5 border border-white/10 rounded-full px-6 py-2 text-sm">
          <span className="text-white/60">Smart Analytics Powered by</span>
          <span className="ml-2 font-semibold">Advanced Algorithms</span>
        </div>

        <h1 className="text-7xl font-bold mb-6 leading-tight">
          Your Financial Future,<br />
          <span className="bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">Predicted by AI</span>
        </h1>

        <p className="text-xl text-gray-400 mb-12 max-w-2xl mx-auto">
          Track expenses, analyze patterns, and get personalized recommendations powered by intelligent analytics.
        </p>

        <button onClick={onSignIn} className="bg-white text-black px-12 py-4 rounded-full text-lg font-bold hover:scale-105 transition-all inline-flex items-center gap-2">
          Get Started Free
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  </div>
);

// ===================== AUTH PAGE =====================
const AuthPage = ({ onAuthSuccess, onBack }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [step, setStep] = useState('credentials');
  const [formData, setFormData] = useState({ email: '', password: '', confirmPassword: '', otp: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState({ score: 0, checks: {} });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const checkPasswordStrength = (password) => {
    const checks = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[!@#$%^&*]/.test(password)
    };
    setPasswordStrength({ score: Object.values(checks).filter(Boolean).length, checks });
  };

  const handlePasswordChange = (e) => {
    const password = e.target.value;
    setFormData({ ...formData, password });
    if (!isLogin) checkPasswordStrength(password);
  };

  const handleSubmitCredentials = async () => {
    if (!formData.email || !formData.password) {
      setError('Fill all fields');
      return;
    }
    if (!isLogin && passwordStrength.score < 4) {
      setError('Password too weak');
      return;
    }
    if (!isLogin && formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/signup';
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email, password: formData.password })
      });

      const data = await res.json();

      if (res.ok) {
        setStep('2fa');
      } else {
        setError(data.error || 'Authentication failed');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitOTP = async () => {
    if (formData.otp.length !== 6) {
      setError('Enter 6-digit OTP');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/auth/verify-otp`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email, otp: formData.otp })
      });

      const data = await res.json();

      if (res.ok) {
        setStep('success');
        setTimeout(() => onAuthSuccess(data), 250);
      } else {
        setError(data.error || 'Invalid OTP');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email })
      });

      const data = await res.json();

      if (res.ok) {
        alert('✅ New OTP sent to your email!');
      } else {
        setError(data.error || 'Failed to resend OTP');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <button onClick={onBack} className="fixed top-6 left-6 text-gray-400 hover:text-white">
        <ArrowLeft className="w-6 h-6" />
      </button>

      <div className="w-full max-w-md">
        {step === 'credentials' && (
          <div className="bg-white/5 border border-white/10 rounded-3xl p-10">
            <div className="text-center mb-8">
              <div className="bg-white/10 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8" />
              </div>
              <h2 className="text-3xl font-bold mb-2">{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
            </div>

            {error && <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-sm">{error}</div>}

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" />
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full pl-12 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:border-white/30 focus:outline-none text-white"
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={handlePasswordChange}
                    className="w-full pl-12 pr-12 py-3 bg-white/5 border border-white/10 rounded-xl focus:border-white/30 focus:outline-none text-white"
                    placeholder="••••••••"
                  />
                  <button onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-3.5 text-gray-400">
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {!isLogin && formData.password && (
                  <div className="mt-3 flex gap-1">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className={`h-1 flex-1 rounded ${i < passwordStrength.score ? 'bg-white' : 'bg-white/10'}`} />
                    ))}
                  </div>
                )}
              </div>

              {isLogin && (
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setStep('forgot');
                  }}
                  className="text-sm text-gray-400 hover:text-white text-right w-full"
                >
                  Forgot password?
                </button>
              )}


              {!isLogin && (
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-300">Confirm Password</label>
                  <input
                    type="password"
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:border-white/30 focus:outline-none text-white"
                    placeholder="••••••••"
                  />
                </div>
              )}

              <button
                onClick={handleSubmitCredentials}
                disabled={loading}
                className="w-full bg-white text-black py-3 rounded-xl font-semibold hover:bg-gray-200 disabled:opacity-50"
              >
                {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
              </button>
            </div>

            <div className="mt-6 text-center">
              <button onClick={() => setIsLogin(!isLogin)} className="text-gray-400 hover:text-white">
                {isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
              </button>
            </div>
          </div>
        )}

        {step === 'forgot' && (
          <div className="bg-white/5 border border-white/10 rounded-3xl p-10">
            <div className="text-center mb-8">
              <div className="bg-white/10 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8" />
              </div>
              <h2 className="text-3xl font-bold mb-2">Reset Password</h2>
              <p className="text-gray-400">We’ll send an OTP to your email</p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:border-white/30 focus:outline-none text-white"
                  placeholder="you@example.com"
                />
              </div>

              <button
                disabled={loading}
                onClick={async () => {
                  if (!formData.email) {
                    setError('Email is required');
                    return;
                  }

                  setError('');
                  setLoading(true);

                  try {
                    const res = await fetch(`${API_URL}/auth/forgot-password`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: formData.email })
                    });

                    const data = await res.json();

                    if (res.ok) {
                      setStep('reset');
                    } else {
                      setError(data.error || 'Failed to send OTP');
                    }
                  } catch {
                    setError('Network error. Please try again.');
                  } finally {
                    setLoading(false);
                  }
                }}
                className="w-full bg-white text-black py-3 rounded-xl font-semibold hover:bg-gray-200 disabled:opacity-50"
              >
                {loading ? 'Sending OTP...' : 'Send OTP'}
              </button>

              <button
                onClick={() => {
                  setError('');
                  setStep('credentials');
                }}
                className="w-full text-gray-400 hover:text-white text-sm"
              >
                Back to login
              </button>
            </div>
          </div>
        )}

        {step === 'reset' && (
          <div className="bg-white/5 border border-white/10 rounded-3xl p-10">
            <div className="text-center mb-8">
              <div className="bg-white/10 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8" />
              </div>
              <h2 className="text-3xl font-bold mb-2">Verify OTP</h2>
              <p className="text-gray-400">Enter OTP and set a new password</p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-5">
              <input
                type="text"
                maxLength="6"
                value={formData.otp}
                onChange={(e) =>
                  setFormData({ ...formData, otp: e.target.value.replace(/\D/g, '') })
                }
                className="w-full px-4 py-4 text-center text-3xl font-bold tracking-[1em] bg-white/5 border border-white/10 rounded-xl focus:border-white/30 focus:outline-none text-white"
                placeholder="000000"
              />

              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:border-white/30 focus:outline-none text-white"
                placeholder="New password"
              />

              <button
                disabled={loading}
                onClick={async () => {
                  if (formData.otp.length !== 6 || !formData.password) {
                    setError('OTP and new password are required');
                    return;
                  }

                  setError('');
                  setLoading(true);

                  try {
                    const res = await fetch(`${API_URL}/auth/reset-password`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        email: formData.email,
                        otp: formData.otp,
                        newPassword: formData.password
                      })
                    });

                    const data = await res.json();

                    if (res.ok) {
                      alert('✅ Password reset successful');
                      setFormData({ email: '', password: '', confirmPassword: '', otp: '' });
                      setStep('credentials');
                    } else {
                      setError(data.error || 'Reset failed');
                    }
                  } catch {
                    setError('Network error. Please try again.');
                  } finally {
                    setLoading(false);
                  }
                }}
                className="w-full bg-white text-black py-3 rounded-xl font-semibold hover:bg-gray-200 disabled:opacity-50"
              >
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>

              <button
                onClick={() => {
                  setError('');
                  setStep('credentials');
                }}
                className="w-full text-gray-400 hover:text-white text-sm"
              >
                Back to login
              </button>
            </div>
          </div>
        )}



        {step === '2fa' && (
          <div className="bg-white/5 border border-white/10 rounded-3xl p-10">
            <div className="text-center mb-8">
              <div className="bg-white/10 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8" />
              </div>
              <h2 className="text-3xl font-bold mb-2">Verify Identity</h2>
              <p className="text-gray-400">Code sent to {formData.email}</p>
            </div>

            {error && <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-sm">{error}</div>}

            <div className="space-y-5">
              <input
                type="text"
                maxLength="6"
                value={formData.otp}
                onChange={(e) => setFormData({ ...formData, otp: e.target.value.replace(/\D/g, '') })}
                className="w-full px-4 py-4 text-center text-3xl font-bold tracking-[1em] bg-white/5 border border-white/10 rounded-xl focus:border-white/30 focus:outline-none text-white"
                placeholder="000000"
              />

              <button onClick={handleSubmitOTP} disabled={loading} className="w-full bg-white text-black py-3 rounded-xl font-semibold hover:bg-gray-200 disabled:opacity-50">
                {loading ? 'Verifying...' : 'Verify & Continue'}
              </button>

              <button onClick={handleResendOTP} disabled={loading} className="w-full text-gray-400 hover:text-white text-sm">
                Didn't receive code? Resend
              </button>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="bg-white/5 border border-white/10 rounded-3xl p-10 text-center">
            <div className="bg-white w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-black" />
            </div>
            <h2 className="text-3xl font-bold mb-2">Verified!</h2>
            <p className="text-gray-400">Setting up your account...</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ===================== ONBOARDING =====================
const OnboardingFlow = ({ userData, token, onComplete }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [answers, setAnswers] = useState({ userType: '', monthlyIncome: '', targetSavings: '', reminderTime: '20:00' });
  const totalSteps = 4;
  const progress = (currentStep / totalSteps) * 100;

  const handleNext = async (data) => {
    const updated = { ...answers, ...data };
    setAnswers(updated);

    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    } else {
      try {
        const res = await fetch(`${API_URL}/users/onboarding`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: userData.userId, ...updated })
        });
        if (res.ok) onComplete(updated);
        else alert('Failed to save onboarding. Please try again.');
      } catch (err) {
        alert('Network error. Please try again.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed top-0 w-full h-1 bg-white/10">
        <div className="h-full bg-white transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          {currentStep === 1 && <Step1 onNext={handleNext} data={answers} />}
          {currentStep === 2 && <Step2 onNext={handleNext} onBack={() => setCurrentStep(1)} data={answers} />}
          {currentStep === 3 && <Step3 onNext={handleNext} onBack={() => setCurrentStep(2)} data={answers} />}
          {currentStep === 4 && <Step4 onNext={handleNext} onBack={() => setCurrentStep(3)} data={answers} />}
        </div>
      </div>
    </div>
  );
};

const Step1 = ({ onNext, data }) => {
  const [selected, setSelected] = useState(data.userType || '');
  return (
    <div className="bg-white/5 border border-white/10 rounded-3xl p-12">
      <h2 className="text-4xl font-bold mb-8">What's your current status?</h2>
      <div className="grid grid-cols-2 gap-6 mb-8">
        <button onClick={() => setSelected('salaried')} className={`p-8 rounded-2xl border-2 ${selected === 'salaried' ? 'border-white bg-white/10' : 'border-white/10'}`}>
          <Briefcase className="w-16 h-16 mb-4 mx-auto" />
          <h3 className="text-xl font-bold">Salaried</h3>
        </button>
        <button onClick={() => setSelected('student')} className={`p-8 rounded-2xl border-2 ${selected === 'student' ? 'border-white bg-white/10' : 'border-white/10'}`}>
          <GraduationCap className="w-16 h-16 mb-4 mx-auto" />
          <h3 className="text-xl font-bold">Student</h3>
        </button>
      </div>
      <button onClick={() => selected && onNext({ userType: selected })} disabled={!selected} className="w-full bg-white text-black py-4 rounded-xl font-semibold disabled:opacity-30">
        Continue
      </button>
    </div>
  );
};

const Step2 = ({ onNext, onBack, data }) => {
  const [income, setIncome] = useState(data.monthlyIncome || '');
  return (
    <div className="bg-white/5 border border-white/10 rounded-3xl p-12">
      <h2 className="text-4xl font-bold mb-8">Monthly income?</h2>
      <div className="mb-8 relative">
        <input type="number" value={income} onChange={(e) => setIncome(e.target.value)} className="w-full pl-14 pr-4 py-4 text-3xl font-bold bg-white/5 border border-white/10 rounded-xl text-white" placeholder="50000" />
        <span className="absolute right-4 top-5 text-gray-400">₹</span>
      </div>
      <div className="flex gap-4">
        <button onClick={onBack} className="flex-1 bg-white/10 py-4 rounded-xl">Back</button>
        <button onClick={() => income && onNext({ monthlyIncome: parseFloat(income) })} disabled={!income} className="flex-1 bg-white text-black py-4 rounded-xl disabled:opacity-30">Continue</button>
      </div>
    </div>
  );
};

const Step3 = ({ onNext, onBack, data }) => {
  const [savings, setSavings] = useState(data.targetSavings || '');
  const dailyBudget = Math.floor((data.monthlyIncome - (savings || 0)) / 30);
  return (
    <div className="bg-white/5 border border-white/10 rounded-3xl p-12">
      <h2 className="text-4xl font-bold mb-8">Savings goal?</h2>
      <div className="mb-6 relative">
        <input type="number" value={savings} onChange={(e) => setSavings(e.target.value)} className="w-full pl-14 pr-4 py-4 text-3xl font-bold bg-white/5 border border-white/10 rounded-xl text-white" placeholder="15000" />
      </div>
      {savings && (
        <div className="bg-white/5 p-6 rounded-xl mb-6 text-center">
          <p className="text-gray-400 text-sm">Daily Budget</p>
          <p className="text-3xl font-bold">₹{dailyBudget.toLocaleString()}</p>
        </div>
      )}
      <div className="flex gap-4">
        <button onClick={onBack} className="flex-1 bg-white/10 py-4 rounded-xl">Back</button>
        <button onClick={() => savings && onNext({ targetSavings: parseFloat(savings), dailyBudget })} disabled={!savings} className="flex-1 bg-white text-black py-4 rounded-xl disabled:opacity-30">Continue</button>
      </div>
    </div>
  );
};

const Step4 = ({ onNext, onBack, data }) => {
  const [time, setTime] = useState(data.reminderTime || '20:00');
  return (
    <div className="bg-white/5 border border-white/10 rounded-3xl p-12">
      <h2 className="text-4xl font-bold mb-8">Daily reminder?</h2>
      <div className="mb-8 relative">
        <Bell className="absolute left-4 top-4 w-6 h-6 text-gray-400" />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full pl-14 pr-4 py-4 text-3xl font-bold bg-white/5 border border-white/10 rounded-xl text-white" />
      </div>
      <div className="bg-white/5 p-6 rounded-xl mb-8 flex items-start gap-4">
        <Zap className="w-6 h-6 flex-shrink-0" />
        <div>
          <h3 className="font-semibold mb-2">You're all set!</h3>
          <p className="text-gray-400 text-sm">AI will identify your behavior after analyzing your spending patterns.</p>
        </div>
      </div>
      <div className="flex gap-4">
        <button onClick={onBack} className="flex-1 bg-white/10 py-4 rounded-xl">Back</button>
        <button onClick={() => onNext({ reminderTime: time })} className="flex-1 bg-white text-black py-4 rounded-xl">Start Tracking</button>
      </div>
    </div>
  );
};

// ===================== ADD EXPENSE PAGE =====================
const AddExpensePage = ({ userData, token, onExpenseAdded, onBack }) => {
  const [formData, setFormData] = useState({ date: new Date().toISOString().split('T')[0], description: '', category: '', amount: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const categories = ['Food & Dining', 'Groceries', 'Transportation', 'Shopping', 'Entertainment', 'Healthcare', 'Bills & Utilities', 'Education', 'Travel', 'Personal Care', 'Gym & Fitness', 'Others'];

  const handleSubmit = async () => {
    if (!formData.description || !formData.category || !formData.amount) {
      setError('Please fill all fields');
      return;
    }
    setError('');
    setLoading(true);

    const payload = {
      userId: userData.userId,
      date: formData.date,
      description: formData.description,
      category: formData.category,
      amount: parseFloat(formData.amount),
      totalExpense: parseFloat(formData.amount)
    };

    try {
      const res = await fetch(`${API_URL}/expenses/add`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        const returned = data.expense || { ...payload };
        onExpenseAdded(returned);
      } else {
        setError(data.error || 'Failed to add expense');
      }
    } catch (err) {
      console.error('Add expense failed', err);
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <button onClick={onBack} className="mb-6 text-gray-400 hover:text-white flex items-center gap-2">
        <ArrowLeft className="w-5 h-5" /> Back
      </button>

      <div className="max-w-2xl mx-auto bg-white/5 border border-white/10 rounded-3xl p-10">
        <h2 className="text-3xl font-bold mb-8">Add Expense</h2>

        {error && <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-sm">{error}</div>}

        <div className="space-y-6">
          <div>
            <label className="block text-sm mb-2 text-gray-300">Date</label>
            <input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white" />
          </div>

          <div>
            <label className="block text-sm mb-2 text-gray-300">Description</label>
            <input type="text" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white" placeholder="e.g., Lunch at restaurant" />
          </div>

          <div>
            <label className="block text-sm mb-2 text-gray-300">Category</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white"
            >
              <option value="" style={{ backgroundColor: '#0b0b0b', color: '#fff' }}>Select category</option>
              {categories.map(cat => (
                <option key={cat} value={cat} style={{ backgroundColor: '#0b0b0b', color: '#fff' }}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm mb-2 text-gray-300">Amount</label>
            <div className="relative">
              <input type="number" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white" placeholder="0.00" />
              <span className="absolute right-4 top-3 text-gray-400">₹</span>
            </div>
          </div>

          <button onClick={handleSubmit} disabled={loading} className="w-full bg-white text-black py-4 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-gray-200 disabled:opacity-50">
            <Plus className="w-5 h-5" /> {loading ? 'Adding...' : 'Add Expense'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ===================== DASHBOARD =====================
const Dashboard = ({
  userData, setUserData, expenses, setExpenses, token,
  onAddExpense, onViewExpenses, onViewAnalytics, onViewReports, onViewAI, onLogout, onViewDailyReport,
  onExportPDF, onImportClick, isExporting, isImporting, importMessage
}) => {
  const [mlInsights, setMlInsights] = useState(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [mlStatus, setMlStatus] = useState(null);

  const totalSpent = expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
  const remainingBudget = (userData.profile?.monthlyIncome || 0) - totalSpent;

  const computeDailyAllowance = () => {
    const monthly = Number(userData.profile?.monthlyIncome || 0);
    const savings = Number(userData.profile?.targetSavings || 0);
    if (monthly <= 0) return 0;
    const allowance = Math.floor((monthly - savings) / 30);
    return allowance > 0 ? allowance : 0;
  };
  const dailyAllowance = userData.profile?.dailyBudget !== undefined ? Number(userData.profile.dailyBudget) : computeDailyAllowance();

  const computeDailySaveNeeded = () => {
    const monthlySavings = Number(userData.profile?.targetSavings || 0);
    if (monthlySavings <= 0) return 0;
    return Math.ceil(monthlySavings / 30);
  };
  const dailySaveNeeded = computeDailySaveNeeded();

  const todayISO = new Date().toISOString().split('T')[0];
  const spentToday = expenses.reduce((sum, e) => {
    const expDate = (e.date || e.createdAt || '').split('T')[0];
    return sum + (expDate === todayISO ? parseFloat(e.amount || 0) : 0);
  }, 0);

  const remainingToday = Math.max(0, dailyAllowance - spentToday);
  const overBudget = spentToday > dailyAllowance;
  const overAmount = overBudget ? (spentToday - dailyAllowance) : 0;

  const fetchExpenses = async () => {
    if (!userData.userId || !token) return;
    try {
      const res = await fetch(`${API_URL}/expenses/${userData.userId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setExpenses(data.expenses || []);
      }
    } catch (err) {
      console.error('Failed to fetch expenses', err);
    }
  };

  const checkMLHealth = async () => {
    try {
      const res = await fetch(`${API_URL}/ml/health`);
      const data = await res.json();
      setMlStatus(data.status);
    } catch (err) {
      setMlStatus('disconnected');
    }
  };

  const fetchMLInsights = async () => {
    if (!userData.userId || !token) return;
    try {
      setLoadingInsights(true);
      const res = await fetch(`${API_URL}/ml/results/${userData.userId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setMlInsights(data);
      }
    } catch (err) {
      console.error('Failed to fetch ml insights', err);
    } finally {
      setLoadingInsights(false);
    }
  };

  const triggerAnalysis = async () => {
    if (!userData.userId || !token) return;
    try {
      setLoadingInsights(true);
      const res = await fetch(`${API_URL}/ml/analyze/${userData.userId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenses })
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setMlInsights(data.analysis || data);
        alert('✅ AI analysis complete!');
      } else {
        alert(data?.error || data?.message || 'Analysis failed.');
      }
    } catch (err) {
      console.error('Trigger analysis error', err);
      alert('❌ Failed to trigger analysis.');
    } finally {
      setLoadingInsights(false);
    }
  };

  useEffect(() => {
    if (userData.userId && token) {
      fetchExpenses();
      checkMLHealth();
      fetchMLInsights();
      const interval = setInterval(fetchMLInsights, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [userData.userId, token]);

  const handleEditDailyAllowance = async () => {
    const current = dailyAllowance;
    const input = prompt('Set your daily allowance (₹)', String(current || ''));
    if (input === null) return;
    const parsed = parseFloat(input);
    if (isNaN(parsed) || parsed < 0) {
      alert('Please enter a valid non-negative number');
      return;
    }

    const payload = {
      userId: userData.userId,
      userType: userData.profile?.userType || '',
      monthlyIncome: Number(userData.profile?.monthlyIncome || 0),
      targetSavings: Number(userData.profile?.targetSavings || 0),
      dailyBudget: parsed,
      reminderTime: userData.profile?.reminderTime || '20:00'
    };

    try {
      const res = await fetch(`${API_URL}/users/onboarding`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setUserData(prev => ({ ...prev, profile: { ...(prev.profile || {}), ...payload, onboardingComplete: true } }));
        alert('✅ Daily allowance updated');
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to update allowance on server');
      }
    } catch (err) {
      console.error('Persist allowance error', err);
      alert('Network error. Could not save allowance');
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Sidebar */}
      <div className="fixed left-0 top-0 h-full w-64 bg-white/5 border-r border-white/10 p-6 overflow-y-auto">
        <div className="flex items-center gap-3 mb-10">
          <div className="bg-white p-2 rounded-xl"><TrendingUp className="w-6 h-6 text-black" /></div>
          <span className="text-xl font-bold">ExpenseAI</span>
        </div>

        <nav className="space-y-2">
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/10 text-white">
            <Home className="w-5 h-5" /> Dashboard
          </button>
          <button onClick={onViewExpenses} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10 text-gray-400">
            <FileText className="w-5 h-5" /> Expenses
          </button>
          <button onClick={onViewAnalytics} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10 text-gray-400">
            <BarChart className="w-5 h-5" /> Analytics
          </button>
          <button onClick={onViewReports} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10 text-gray-400">
            <FileText className="w-5 h-5" /> Reports
          </button>
          <button onClick={onViewAI} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10 text-gray-400">
            <Brain className="w-5 h-5" /> AI Analysis
          </button>
          <button onClick={onViewDailyReport} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10 text-gray-400">
            <Calendar className="w-5 h-5" /> Daily Report
          </button>
        </nav>

        {mlStatus && (
          <div className={`mt-6 p-3 rounded-xl text-xs ${mlStatus === 'connected' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${mlStatus === 'connected' ? 'bg-green-400' : 'bg-red-400'}`} />
              AI Model {mlStatus === 'connected' ? 'Online' : 'Offline'}
            </div>
          </div>
        )}

        <button onClick={onLogout} className="absolute bottom-6 left-6 right-6 flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10 text-gray-400">
          <LogOut className="w-5 h-5" /> Logout
        </button>
      </div>

      {/* Main */}
      <div className="ml-64 p-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Welcome</h1>
            <p className="text-gray-400">{userData.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => onExportPDF({ allTime: true })} disabled={isExporting} className="bg-white/10 text-white px-4 py-2 rounded-xl hover:bg-white/20 text-sm flex items-center gap-2">
              <Download className="w-4 h-4" />
              {isExporting ? 'Exporting...' : 'Export PDF'}
            </button>

            <button onClick={onImportClick} disabled={isImporting} className="bg-white/10 text-white px-4 py-2 rounded-xl hover:bg-white/20 text-sm flex items-center gap-2">
              <Upload className="w-4 h-4" />
              {isImporting ? 'Importing...' : 'Import File'}
            </button>

            <button onClick={onAddExpense} className="bg-white text-black px-6 py-3 rounded-xl font-semibold flex items-center gap-2 hover:bg-gray-200">
              <Plus className="w-5 h-5" /> Add Expense
            </button>
          </div>
        </div>

        {importMessage && (
          <div className="mb-4 p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-gray-200">
            {importMessage}
          </div>
        )}

        {overBudget && (
          <div className="mb-6 p-4 rounded-lg bg-red-600/20 border border-red-500 text-red-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">Warning — daily budget exceeded</p>
                <p className="text-sm">You've exceeded your daily allowance by <span className="font-bold">₹{overAmount.toFixed(2)}</span> today.</p>
              </div>
              <div>
                <button onClick={handleEditDailyAllowance} className="bg-red-500/10 px-3 py-1 rounded-lg hover:bg-red-500/20 text-sm">Adjust allowance</button>
              </div>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-2">Monthly Income</p>
            <p className="text-3xl font-bold">₹{(userData.profile?.monthlyIncome || 0).toLocaleString()}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-2">Total Spent</p>
            <p className="text-3xl font-bold">₹{totalSpent.toLocaleString()}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <p className="text-gray-400 text-sm mb-2">Remaining</p>
            <p className="text-3xl font-bold">₹{remainingBudget.toLocaleString()}</p>
          </div>
        </div>

        <div className="mb-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 w-full max-w-2xl">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-gray-400 text-sm mb-2">Daily Allowance</p>
                <p className="text-2xl font-bold">₹{dailyAllowance.toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-1">Today's spent: ₹{spentToday.toLocaleString()}</p>
                <p className="text-sm font-semibold mt-2">Remaining today: ₹{remainingToday.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-400 text-sm mb-2">Daily Save Goal</p>
                <p className="text-2xl font-bold">₹{dailySaveNeeded.toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-1">Monthly target ÷ 30</p>
                <div className="mt-3">
                  <button onClick={handleEditDailyAllowance} className="text-sm bg-white/10 px-3 py-1 rounded-lg hover:bg-white/20">Edit Allowance</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {mlInsights ? (
          <div className="bg-gradient-to-r from-slate-800/20 to-sky-600/20 border border-slate-700/30 rounded-2xl p-6 mb-8">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-2xl font-bold flex items-center gap-2">AI Behavior Analysis</h3>
                <p className="text-sm text-gray-400 mt-1">Based on {mlInsights.analysis_period?.days_analyzed} days of spending data</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setMlInsights(null)} className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl text-sm">Clear</button>
                <button onClick={onViewAI} className="bg-white px-4 py-2 rounded-xl text-sm text-black">Open Full Analysis</button>
              </div>
            </div>

            <div className="bg-white/5 rounded-xl p-6 mb-4">
              <div className="flex items-start gap-4">
                <div className="bg-slate-700/20 p-4 rounded-xl"><Brain className="w-8 h-8 text-sky-400" /></div>
                <div className="flex-1">
                  <p className="text-gray-400 text-sm mb-1">Your Spending Personality</p>
                  <h4 className="text-3xl font-bold mb-2 capitalize">{mlInsights.behavior_prediction?.predicted_behavior?.replace(/_/g, ' ')}</h4>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-white/10 rounded-full h-2">
                      <div className="bg-sky-400 h-2 rounded-full transition-all" style={{ width: `${mlInsights.behavior_prediction?.confidence || 0}%` }} />
                    </div>
                    <span className="text-sm font-semibold">{mlInsights.behavior_prediction?.confidence?.toFixed(1)}% confident</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4 mb-4">
              {mlInsights.behavior_prediction?.top_3_predictions?.map((pred, idx) => (
                <div key={idx} className="bg-white/5 p-4 rounded-xl">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-gray-400">#{idx + 1}</span>
                    <span className="text-sm font-semibold">{pred.confidence?.toFixed(1)}%</span>
                  </div>
                  <p className="text-sm font-medium capitalize">{pred.behavior?.replace(/_/g, ' ')}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 mb-8 text-center">
            <Brain className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <h3 className="text-xl font-bold mb-2">AI Insights Not Available Yet</h3>
            <p className="text-gray-400 mb-4">Add expenses to unlock AI-powered behavior analysis</p>
            <button onClick={onViewAI} className="bg-sky-600 hover:bg-sky-700 px-6 py-3 rounded-xl font-semibold">Open AI Analysis</button>
          </div>
        )}

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold">Recent Transactions</h3>
            <button onClick={onViewExpenses} className="text-sm text-gray-400 hover:text-white">View All →</button>
          </div>
          {expenses.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Calendar className="w-16 h-16 mx-auto mb-4" />
              <p>No expenses yet. Start tracking!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {expenses.slice(-10).reverse().map((expense, idx) => (
                <div key={idx} className="flex justify-between items-center p-4 bg-white/5 rounded-xl">
                  <div>
                    <p className="font-semibold">{expense.description}</p>
                    <p className="text-sm text-gray-400">{expense.category}</p>
                  </div>
                  <p className="text-xl font-bold">₹{parseFloat(expense.amount).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
// ===================== EXPENSES PAGE (NEW - with Edit/Delete/Search/Filter) =====================
const ExpensesPage = ({ userData, token, expenses, setExpenses, onBack, refreshExpenses }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [editingExpense, setEditingExpense] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // Missing-days feature state
  const [missingDates, setMissingDates] = useState([]);
  const [missingModalOpen, setMissingModalOpen] = useState(false);
  const [selectedMissingDate, setSelectedMissingDate] = useState(null);
  const [missingForm, setMissingForm] = useState({ description: '', category: 'No Expense', amount: '' });
  const [processingMissing, setProcessingMissing] = useState(false);

  const categories = ['All', 'Food & Dining', 'Groceries', 'Transportation', 'Shopping', 'Entertainment', 'Healthcare', 'Bills & Utilities', 'Education', 'Travel', 'Personal Care', 'Gym & Fitness', 'Others', 'No Expense'];

  useEffect(() => {
    if (userData?.userId && token) {
      refreshExpenses();
    }
  }, [userData?.userId, token, refreshExpenses]);

  // Compute missing dates for last N days (default 30)
  useEffect(() => {
    const computeMissing = () => {
      const N = 30; // window size (last N days)
      const today = new Date();
      const dateList = [];
      for (let i = 0; i < N; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dateList.push(d.toISOString().split('T')[0]);
      }
      const haveDates = new Set((expenses || []).map(e => e.date));
      const missing = dateList.filter(d => !haveDates.has(d));
      setMissingDates(missing);
    };
    computeMissing();
  }, [expenses]);

  const normalized = (s = '') => String(s || '');

  const filteredExpenses = (expenses || []).filter(exp => {
    const desc = normalized(exp.description).toLowerCase();
    const matchesSearch = desc.includes(normalized(searchTerm).toLowerCase());
    const matchesCategory = !filterCategory || filterCategory === 'All' || exp.category === filterCategory;
    const matchesDateFrom = !filterDateFrom || (exp.date && exp.date >= filterDateFrom);
    const matchesDateTo = !filterDateTo || (exp.date && exp.date <= filterDateTo);
    return matchesSearch && matchesCategory && matchesDateFrom && matchesDateTo;
  });

  const handleEdit = (expense) => {
    // Defensive copy
    setEditingExpense({ ...expense });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingExpense) return;
    // Basic validation
    if (!editingExpense.date || !editingExpense.description || editingExpense.description.trim() === '' || editingExpense.amount === '' || editingExpense.amount === null || typeof editingExpense.amount === 'undefined') {
      alert('Please fill in date, description and amount.');
      return;
    }
    const parsedAmount = Number(editingExpense.amount);
    if (!Number.isFinite(parsedAmount)) {
      alert('Please enter a valid amount.');
      return;
    }
    // Validate date
    const d = new Date(editingExpense.date);
    if (isNaN(d.getTime())) {
      alert('Please enter a valid date.');
      return;
    }

    setSavingEdit(true);
    try {
      const res = await fetch(`${API_URL}/expenses/${encodeURIComponent(editingExpense.expenseId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userData.userId,
          date: editingExpense.date,
          description: editingExpense.description,
          category: editingExpense.category,
          amount: parsedAmount
        })
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        // Refresh authoritative data from server
        await refreshExpenses();
        setShowEditModal(false);
        setEditingExpense(null);
        alert('✅ Expense updated successfully!');
      } else {
        alert(`Failed to update: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Edit expense error:', err);
      alert('❌ Failed to update expense');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (expenseId) => {
    if (!expenseId) {
      alert('Cannot delete: missing expense identifier.');
      return;
    }
    if (!window.confirm('Are you sure you want to delete this expense?')) return;

    setDeletingId(expenseId);
    try {
      const res = await fetch(`${API_URL}/expenses/${encodeURIComponent(expenseId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.userId })
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        await refreshExpenses();
        alert('✅ Expense deleted successfully!');
      } else {
        alert(`Failed to delete: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Delete expense error:', err);
      alert('❌ Failed to delete expense');
    } finally {
      setDeletingId(null);
    }
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilterCategory('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  // Missing-days helpers
  const openMissingModal = (date) => {
    setSelectedMissingDate(date);
    setMissingForm({ description: '', category: 'No Expense', amount: '' });
    setMissingModalOpen(true);
  };

  const markNoExpense = async (date) => {
    if (!userData?.userId) return;
    if (!window.confirm(`Mark ${date} as "No expense" (amount ₹0)?`)) return;
    setProcessingMissing(true);
    try {
      const payload = {
        userId: userData.userId,
        date,
        description: 'No expense',
        category: 'No Expense',
        amount: 0,
        totalExpense: 0
      };
      const res = await fetch(`${API_URL}/expenses/add`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await refreshExpenses();
        alert(`Marked ${date} as no-expense.`);
      } else {
        alert(`Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('markNoExpense error', err);
      alert('Network/server error.');
    } finally {
      setProcessingMissing(false);
    }
  };

  const handleAddForMissing = async () => {
    if (!selectedMissingDate) return;
    const { description, category, amount } = missingForm;
    if (!description || description.trim() === '') {
      alert('Please enter a description.');
      return;
    }
    const parsed = amount === '' ? NaN : Number(amount);
    if (isNaN(parsed)) {
      alert('Enter a valid amount (or leave blank to mark as 0).');
      return;
    }
    setProcessingMissing(true);
    try {
      const payload = {
        userId: userData.userId,
        date: selectedMissingDate,
        description,
        category: category || 'Others',
        amount: parsed,
        totalExpense: parsed
      };
      const res = await fetch(`${API_URL}/expenses/add`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await refreshExpenses();
        setMissingModalOpen(false);
        setSelectedMissingDate(null);
        alert('✅ Expense added for ' + payload.date);
      } else {
        alert(`Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('handleAddForMissing error', err);
      alert('Network/server error.');
    } finally {
      setProcessingMissing(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-7xl mx-auto">
        <button onClick={onBack} className="mb-6 text-gray-400 hover:text-white flex items-center gap-2">
          <ArrowLeft className="w-5 h-5" /> Back to Dashboard
        </button>

        {/* Missing days banner */}
        {missingDates.length > 0 && (
          <div className="mb-6 p-4 rounded-xl bg-yellow-600/10 border border-yellow-500/20 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold">You have {missingDates.length} day(s) without entries in the last 30 days.</p>
              <p className="text-sm text-gray-300">Click "Review" to fill them or mark as "No expense".</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setMissingModalOpen(true)} className="bg-yellow-500 text-black px-4 py-2 rounded-xl">Review Missing Days</button>
              <button onClick={() => { /* quick-mark: mark all as no-expense if desired (confirm) */ const ok = window.confirm(`Mark all ${missingDates.length} missing days as "No expense"?`); if (ok) { (async () => { for (const d of missingDates) { await markNoExpense(d); } })(); } }} className="bg-white/10 px-4 py-2 rounded-xl">Mark All No-Expense</button>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mb-6">
          <h2 className="text-3xl font-bold">All Expenses</h2>
          <div className="text-gray-400">
            Showing {filteredExpenses.length} of {(expenses || []).length} expenses
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
          <div className="grid md:grid-cols-4 gap-4 mb-4">
            <div className="md:col-span-2">
              <label className="block text-sm mb-2 text-gray-400">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by description..."
                  className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm mb-2 text-gray-400">Category</label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white"
              >
                {categories.map(cat => (
                  <option key={cat} value={cat === 'All' ? '' : cat} style={{ backgroundColor: '#0b0b0b' }}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm mb-2 text-gray-400">Date Range</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="flex-1 px-2 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm"
                />
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="flex-1 px-2 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-400">
              {(searchTerm || filterCategory || filterDateFrom || filterDateTo) && (
                <span>Active filters applied</span>
              )}
            </div>
            <button
              onClick={clearFilters}
              className="text-sm text-gray-400 hover:text-white flex items-center gap-2"
            >
              <X className="w-4 h-4" /> Clear Filters
            </button>
          </div>
        </div>

        {/* Expenses List */}
        {filteredExpenses.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center">
            <FileText className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <p className="text-gray-400">No expenses found matching your filters</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredExpenses.map((expense, idx) => (
              <div key={expense.expenseId || idx} className="bg-white/5 border border-white/10 rounded-xl p-5 flex items-center justify-between hover:bg-white/10 transition-colors">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <p className="font-semibold text-lg">{expense.description || '—'}</p>
                    <span className="px-2 py-1 bg-white/10 rounded text-xs">{expense.category || 'Others'}</span>
                  </div>
                  <p className="text-sm text-gray-400">{expense.date || ''}</p>
                </div>
                <div className="flex items-center gap-4">
                  <p className="text-2xl font-bold">₹{parseFloat(expense.amount || 0).toLocaleString()}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(expense)}
                      className="p-2 bg-blue-500/20 hover:bg-blue-500/30 rounded-lg text-blue-400"
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(expense.expenseId)}
                      className="p-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-red-400"
                      title="Delete"
                      disabled={deletingId === expense.expenseId}
                    >
                      {deletingId === expense.expenseId ? <span className="text-xs">Deleting...</span> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {showEditModal && editingExpense && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
          <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 max-w-md w-full">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-bold">Edit Expense</h3>
              <button onClick={() => { setShowEditModal(false); setEditingExpense(null); }} className="text-gray-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm mb-2 text-gray-300">Date</label>
                <input
                  type="date"
                  value={editingExpense.date || ''}
                  onChange={(e) => setEditingExpense({ ...editingExpense, date: e.target.value })}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white"
                />
              </div>

              <div>
                <label className="block text-sm mb-2 text-gray-300">Description</label>
                <input
                  type="text"
                  value={editingExpense.description || ''}
                  onChange={(e) => setEditingExpense({ ...editingExpense, description: e.target.value })}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white"
                />
              </div>

              <div>
                <label className="block text-sm mb-2 text-gray-300">Category</label>
                <select
                  value={editingExpense.category || ''}
                  onChange={(e) => setEditingExpense({ ...editingExpense, category: e.target.value })}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white"
                >
                  {categories.filter(c => c !== 'All').map(cat => (
                    <option key={cat} value={cat} style={{ backgroundColor: '#0b0b0b' }}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm mb-2 text-gray-300">Amount</label>
                <div className="relative">
                  <input
                    type="number"
                    value={editingExpense.amount ?? ''}
                    onChange={(e) => setEditingExpense({ ...editingExpense, amount: e.target.value })}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white"
                  />
                  <span className="absolute right-4 top-3 text-gray-400">₹</span>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => { setShowEditModal(false); setEditingExpense(null); }}
                  className="flex-1 bg-white/10 text-white py-3 rounded-xl hover:bg-white/20"
                  disabled={savingEdit}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 bg-white text-black py-3 rounded-xl hover:bg-gray-200 flex items-center justify-center gap-2"
                  disabled={savingEdit}
                >
                  {savingEdit ? 'Saving...' : (<><Save className="w-4 h-4" /> Save Changes</>)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Missing-days modal */}
      {missingModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
          <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-6 max-w-3xl w-full overflow-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-2xl font-bold">Missing Days (last 30 days)</h3>
              <button onClick={() => { setMissingModalOpen(false); setSelectedMissingDate(null); }} className="text-gray-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>

            {missingDates.length === 0 ? (
              <div className="text-center py-8 text-gray-300">No missing days — great job!</div>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {missingDates.map(d => (
                  <div key={d} className="p-4 bg-white/5 rounded-lg flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{d}</div>
                      <div className="text-sm text-gray-400">No entries recorded</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => openMissingModal(d)} className="px-3 py-1 bg-white text-black rounded">Add</button>
                      <button onClick={() => markNoExpense(d)} className="px-3 py-1 bg-white/10 rounded">Mark No-Expense</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Inline add form for selected missing date */}
            {selectedMissingDate && (
              <div className="mt-6 bg-white/5 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">Add expense for {selectedMissingDate}</h4>
                <div className="grid md:grid-cols-3 gap-3">
                  <input type="text" placeholder="Description" value={missingForm.description} onChange={(e) => setMissingForm(f => ({ ...f, description: e.target.value }))} className="px-3 py-2 bg-white/10 rounded" />
                  <select value={missingForm.category} onChange={(e) => setMissingForm(f => ({ ...f, category: e.target.value }))} className="px-3 py-2 bg-white/10 rounded">
                    {categories.filter(c => c !== 'All').map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                  </select>
                  <div className="relative">
                    <input type="number" placeholder="Amount" value={missingForm.amount} onChange={(e) => setMissingForm(f => ({ ...f, amount: e.target.value }))} className="w-full px-3 py-2 bg-white/10 rounded" />
                    <span className="absolute right-3 top-2 text-gray-300">₹</span>
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button onClick={() => { setSelectedMissingDate(null); setMissingForm({ description: '', category: 'No Expense', amount: '' }); }} className="px-4 py-2 bg-white/10 rounded">Cancel</button>
                  <button onClick={handleAddForMissing} disabled={processingMissing} className="px-4 py-2 bg-white text-black rounded">
                    {processingMissing ? 'Saving...' : 'Save Expense'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
// ===================== ANALYTICS PAGE (NEW - with Charts) =====================
const AnalyticsPage = ({ expenses, onBack }) => {
  // Process data for charts
  const getCategoryData = () => {
    const categoryTotals = {};
    expenses.forEach(exp => {
      const cat = exp.category || 'Others';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + parseFloat(exp.amount || 0);
    });
    return categoryTotals;
  };

  const getMonthlyData = () => {
    const monthlyTotals = {};
    expenses.forEach(exp => {
      const date = new Date(exp.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + parseFloat(exp.amount || 0);
    });
    return monthlyTotals;
  };

  const getDailyTrend = () => {
    const dailyTotals = {};
    expenses.forEach(exp => {
      const date = exp.date;
      dailyTotals[date] = (dailyTotals[date] || 0) + parseFloat(exp.amount || 0);
    });
    
    // Get last 30 days
    const sortedDates = Object.keys(dailyTotals).sort().slice(-30);
    return sortedDates.reduce((acc, date) => {
      acc[date] = dailyTotals[date];
      return acc;
    }, {});
  };

  const categoryData = getCategoryData();
  const monthlyData = getMonthlyData();
  const dailyTrend = getDailyTrend();

  // Chart configurations
  const pieChartData = {
    labels: Object.keys(categoryData),
    datasets: [{
      data: Object.values(categoryData),
      backgroundColor: [
        '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
        '#FF9F40', '#FF6384', '#C9CBCF', '#4BC0C0', '#FF9F40'
      ],
      borderWidth: 2,
      borderColor: '#0b0b0b'
    }]
  };

  const barChartData = {
    labels: Object.keys(monthlyData),
    datasets: [{
      label: 'Monthly Spending',
      data: Object.values(monthlyData),
      backgroundColor: '#00d9ff',
      borderColor: '#00d9ff',
      borderWidth: 1
    }]
  };

  const lineChartData = {
    labels: Object.keys(dailyTrend),
    datasets: [{
      label: 'Daily Spending (Last 30 Days)',
      data: Object.values(dailyTrend),
      borderColor: '#00d9ff',
      backgroundColor: 'rgba(0, 217, 255, 0.1)',
      fill: true,
      tension: 0.4
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: '#ffffff'
        }
      }
    },
    scales: {
      x: {
        ticks: { color: '#ffffff' },
        grid: { color: 'rgba(255, 255, 255, 0.1)' }
      },
      y: {
        ticks: { color: '#ffffff' },
        grid: { color: 'rgba(255, 255, 255, 0.1)' }
      }
    }
  };

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          color: '#ffffff',
          padding: 15
        }
      }
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-7xl mx-auto">
        <button onClick={onBack} className="mb-6 text-gray-400 hover:text-white flex items-center gap-2">
          <ArrowLeft className="w-5 h-5" /> Back to Dashboard
        </button>

        <h2 className="text-3xl font-bold mb-8">Analytics & Insights</h2>

        {expenses.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center">
            <BarChart3 className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <p className="text-gray-400">No data yet. Add some expenses to see beautiful charts!</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <p className="text-gray-400 text-sm mb-2">Total Expenses</p>
                <p className="text-3xl font-bold">₹{expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0).toLocaleString()}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <p className="text-gray-400 text-sm mb-2">Average Per Day</p>
                <p className="text-3xl font-bold">₹{(expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0) / Math.max(1, Object.keys(dailyTrend).length)).toFixed(0)}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <p className="text-gray-400 text-sm mb-2">Total Transactions</p>
                <p className="text-3xl font-bold">{expenses.length}</p>
              </div>
            </div>

            {/* Daily Trend Line Chart */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h3 className="text-xl font-bold mb-4">Daily Spending Trend</h3>
              <div style={{ height: '300px' }}>
                <Line data={lineChartData} options={chartOptions} />
              </div>
            </div>

            {/* Monthly Bar Chart & Category Pie */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <h3 className="text-xl font-bold mb-4">Monthly Spending</h3>
                <div style={{ height: '300px' }}>
                  <Bar data={barChartData} options={chartOptions} />
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <h3 className="text-xl font-bold mb-4">Spending by Category</h3>
                <div style={{ height: '300px' }}>
                  <Pie data={pieChartData} options={pieOptions} />
                </div>
              </div>
            </div>

            {/* Category Breakdown Table */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h3 className="text-xl font-bold mb-4">Category Breakdown</h3>
              <div className="space-y-3">
                {Object.entries(categoryData)
                  .sort((a, b) => b[1] - a[1])
                  .map(([category, amount]) => {
                    const percentage = (amount / expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0) * 100).toFixed(1);
                    return (
                      <div key={category} className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
                        <div className="flex-1">
                          <p className="font-semibold">{category}</p>
                          <div className="mt-2 bg-white/10 rounded-full h-2">
                            <div className="bg-sky-400 h-2 rounded-full" style={{ width: `${percentage}%` }} />
                          </div>
                        </div>
                        <div className="ml-6 text-right">
                          <p className="text-2xl font-bold">₹{amount.toLocaleString()}</p>
                          <p className="text-sm text-gray-400">{percentage}%</p>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ===================== AI ANALYSIS PAGE =====================
const AIAnalysisPage = ({ userData, token, expenses, onBack }) => {
  const [mlInsights, setMlInsights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mlStatus, setMlStatus] = useState(null);

  const fetchMLHealth = async () => {
    try {
      const res = await fetch(`${API_URL}/ml/health`);
      const data = await res.json();
      setMlStatus(data.status);
    } catch (err) {
      setMlStatus('disconnected');
    }
  };

  const fetchMLResults = async () => {
    if (!userData.userId || !token) return;
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/ml/results/${userData.userId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setMlInsights(data);
      } else {
        const data = await res.json().catch(() => ({}));
        console.warn('Fetch ML results failed', data);
      }
    } catch (err) {
      console.error('Failed to fetch ML results', err);
    } finally {
      setLoading(false);
    }
  };

  const triggerAnalysis = async () => {
    if (!userData.userId || !token) return;
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/ml/analyze/${userData.userId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenses })
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setMlInsights(data.analysis || data);
        alert('✅ AI analysis complete!');
      } else {
        alert(data?.error || data?.message || 'Analysis failed.');
      }
    } catch (err) {
      console.error('Trigger analysis error', err);
      alert('❌ Failed to trigger analysis.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMLHealth();
    fetchMLResults();
  }, [userData.userId, token]);

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="text-gray-400 hover:text-white">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h2 className="text-2xl font-bold">AI Behavior Analysis</h2>
            <div className="text-sm text-gray-400 ml-4">{mlStatus === 'connected' ? 'Model Online' : 'Model Offline'}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={triggerAnalysis} disabled={loading} className="bg-white text-black px-4 py-2 rounded-xl">
              {loading ? 'Analyzing...' : 'Run Analysis'}
            </button>
          </div>
        </div>

        {!mlInsights ? (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
            <Brain className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <h3 className="text-xl font-bold mb-2">No analysis yet</h3>
            <p className="text-gray-400 mb-4">Run the analysis to generate personalized insights based on your expenses.</p>
            <button onClick={triggerAnalysis} disabled={loading} className="bg-sky-600 hover:bg-sky-700 px-6 py-3 rounded-xl font-semibold disabled:opacity-50">{loading ? 'Running...' : 'Run Analysis Now'}</button>
          </div>
        ) : (
          <div className="bg-gradient-to-r from-slate-800/20 to-sky-600/20 border border-slate-700/30 rounded-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-2xl font-bold flex items-center gap-2">AI Behavior Analysis</h3>
                <p className="text-sm text-gray-400 mt-1">Based on {mlInsights.analysis_period?.days_analyzed} days of spending data</p>
              </div>
              <div className="text-sm text-gray-400">Confidence: {mlInsights.behavior_prediction?.confidence?.toFixed(1)}%</div>
            </div>

            <div className="bg-white/5 rounded-xl p-6 mb-4">
              <div className="flex items-start gap-4">
                <div className="bg-slate-700/20 p-4 rounded-xl"><Brain className="w-8 h-8 text-sky-400" /></div>
                <div className="flex-1">
                  <p className="text-gray-400 text-sm mb-1">Your Spending Personality</p>
                  <h4 className="text-3xl font-bold mb-2 capitalize">{mlInsights.behavior_prediction?.predicted_behavior?.replace(/_/g, ' ')}</h4>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-white/10 rounded-full h-2">
                      <div className="bg-sky-400 h-2 rounded-full transition-all" style={{ width: `${mlInsights.behavior_prediction?.confidence || 0}%` }} />
                    </div>
                    <span className="text-sm font-semibold">{mlInsights.behavior_prediction?.confidence?.toFixed(1)}% confident</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div className="bg-white/5 p-4 rounded-xl">
                <h5 className="font-semibold mb-3 flex items-center gap-2"><PieChart className="w-5 h-5" /> Spending Overview</h5>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-400">Total Spent</span><span className="font-semibold">₹{mlInsights.spending_analysis?.total_spent?.toFixed(0)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Avg Daily</span><span className="font-semibold">₹{mlInsights.spending_analysis?.avg_daily_expense?.toFixed(0)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Trend</span><span className={`font-semibold capitalize ${mlInsights.spending_analysis?.spending_trend === 'increasing' ? 'text-red-400' : mlInsights.spending_analysis?.spending_trend === 'decreasing' ? 'text-green-400' : 'text-yellow-400'}`}>{mlInsights.spending_analysis?.spending_trend}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Top Category</span><span className="font-semibold">{mlInsights.spending_analysis?.top_spending_category}</span></div>
                </div>
              </div>

              <div className="bg-white/5 p-4 rounded-xl">
                <h5 className="font-semibold mb-3 flex items-center gap-2"><Target className="w-5 h-5" /> AI Recommendations</h5>
                <ul className="space-y-2 text-sm">
                  {mlInsights.recommendations?.map((rec, idx) => <li key={idx} className="flex items-start gap-2 text-gray-300"><span className="text-sky-400 mt-0.5">•</span><span>{rec}</span></li>)}
                </ul>
              </div>
            </div>

            <p className="text-xs text-gray-500 text-center mt-4">Last analyzed: {new Date(mlInsights.analyzedAt).toLocaleString()}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ===================== DAILY REPORT PAGE =====================
const DailyReportPage = ({ expenses, onBack }) => {
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );

  const dailyExpenses = expenses.filter(exp => {
    const expDate = (exp.date || exp.createdAt || '').split('T')[0];
    return expDate === selectedDate;
  });

  const totalSpent = dailyExpenses.reduce(
    (sum, e) => sum + parseFloat(e.amount || 0),
    0
  );

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={onBack}
          className="mb-6 text-gray-400 hover:text-white flex items-center gap-2"
        >
          <ArrowLeft className="w-5 h-5" /> Back
        </button>

        <h2 className="text-3xl font-bold mb-6">Daily Expense Report</h2>

        <div className="mb-6">
          <label className="block text-sm text-gray-400 mb-2">
            Select Date
          </label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white"
          />
        </div>

        {dailyExpenses.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center text-gray-400">
            No expenses found for this date.
          </div>
        ) : (
          <>
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-6">
              <p className="text-gray-400 text-sm">Total Spent</p>
              <p className="text-3xl font-bold">
                ₹{totalSpent.toLocaleString()}
              </p>
            </div>

            <div className="space-y-3">
              {dailyExpenses.map((exp, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center bg-white/5 p-4 rounded-xl"
                >
                  <div>
                    <p className="font-semibold">{exp.description}</p>
                    <p className="text-sm text-gray-400">{exp.category}</p>
                  </div>
                  <p className="text-xl font-bold">
                    ₹{parseFloat(exp.amount).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default App;