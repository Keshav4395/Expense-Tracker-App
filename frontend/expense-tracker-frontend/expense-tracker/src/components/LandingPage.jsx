import React, { useState } from 'react';
import { Mail, Phone, Lock, Eye, EyeOff, Shield, Check, X } from 'lucide-react';

const Login2FA = ({ onLoginSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [step, setStep] = useState('credentials'); // credentials, 2fa, success
  const [twoFAMethod, setTwoFAMethod] = useState('email'); // email or phone
  
  const [formData, setFormData] = useState({
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    otp: ''
  });
  
  const [showPassword, setShowPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState({ score: 0, feedback: [], checks: {} });

  // Password strength checker
  const checkPasswordStrength = (password) => {
    const checks = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[!@#$%^&*]/.test(password)
    };

    const score = Object.values(checks).filter(Boolean).length;
    setPasswordStrength({ score, checks });
  };

  const handlePasswordChange = (e) => {
    const password = e.target.value;
    setFormData({ ...formData, password });
    if (!isLogin) {
      checkPasswordStrength(password);
    }
  };

  const getPasswordStrengthText = () => {
    if (passwordStrength.score <= 2) return 'Weak';
    if (passwordStrength.score <= 3) return 'Fair';
    if (passwordStrength.score <= 4) return 'Good';
    return 'Strong';
  };

  const handleSubmitCredentials = () => {
    if (!formData.email || !formData.password) {
      alert('Please fill all required fields');
      return;
    }
    
    if (!isLogin) {
      if (passwordStrength.score < 4) {
        alert('Please use a stronger password');
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        alert('Passwords do not match');
        return;
      }
    }

    console.log('Sending OTP to:', twoFAMethod === 'email' ? formData.email : formData.phone);
    setStep('2fa');
  };

  const handleSubmitOTP = () => {
    if (formData.otp.length === 6) {
      setStep('success');
      setTimeout(() => {
        onLoginSuccess({
          email: formData.email,
          phone: formData.phone,
          twoFAMethod: twoFAMethod
        });
      }, 1500);
    } else {
      alert('Please enter 6-digit OTP');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
        
        {step === 'credentials' && (
          <>
            <div className="text-center mb-8">
              <div className="bg-gradient-to-r from-purple-600 to-pink-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-3xl font-bold text-gray-800 mb-2">
                {isLogin ? 'Welcome Back!' : 'Create Account'}
              </h2>
              <p className="text-gray-600">
                {isLogin ? 'Login to your account' : 'Sign up to get started'}
              </p>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 border-2 border-gray-300 rounded-xl focus:border-purple-500 focus:outline-none"
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              {!isLogin && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Phone Number (Optional for 2FA)
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full pl-10 pr-4 py-3 border-2 border-gray-300 rounded-xl focus:border-purple-500 focus:outline-none"
                      placeholder="+91 1234567890"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={handlePasswordChange}
                    className="w-full pl-10 pr-12 py-3 border-2 border-gray-300 rounded-xl focus:border-purple-500 focus:outline-none"
                    placeholder="••••••••"
                  />
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>

                {!isLogin && formData.password && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">Password Strength:</span>
                      <span className={`text-sm font-bold ${
                        passwordStrength.score <= 2 ? 'text-red-500' :
                        passwordStrength.score <= 3 ? 'text-yellow-500' :
                        passwordStrength.score <= 4 ? 'text-blue-500' : 'text-green-500'
                      }`}>
                        {getPasswordStrengthText()}
                      </span>
                    </div>
                    
                    <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          passwordStrength.score <= 2 ? 'bg-red-500' :
                          passwordStrength.score <= 3 ? 'bg-yellow-500' :
                          passwordStrength.score <= 4 ? 'bg-blue-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                      />
                    </div>

                    <div className="space-y-1">
                      {Object.entries(passwordStrength.checks).map(([key, passed]) => (
                        <div key={key} className="flex items-center gap-2 text-sm">
                          {passed ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-red-500" />}
                          <span className={passed ? 'text-green-700' : 'text-gray-600'}>
                            {key === 'length' && 'At least 8 characters'}
                            {key === 'uppercase' && 'One uppercase letter'}
                            {key === 'lowercase' && 'One lowercase letter'}
                            {key === 'number' && 'One number'}
                            {key === 'special' && 'One special character'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {!isLogin && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    className="w-full pl-4 pr-4 py-3 border-2 border-gray-300 rounded-xl focus:border-purple-500 focus:outline-none"
                    placeholder="••••••••"
                  />
                  {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                    <p className="text-red-500 text-sm mt-1">Passwords do not match</p>
                  )}
                </div>
              )}

              {!isLogin && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Two-Factor Authentication Method
                  </label>
                  <div className="flex gap-4">
                    <button
                      onClick={() => setTwoFAMethod('email')}
                      className={`flex-1 py-3 rounded-xl font-semibold transition-all ${
                        twoFAMethod === 'email'
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <Mail className="w-5 h-5 inline mr-2" />
                      Email
                    </button>
                    <button
                      onClick={() => setTwoFAMethod('phone')}
                      disabled={!formData.phone}
                      className={`flex-1 py-3 rounded-xl font-semibold transition-all ${
                        twoFAMethod === 'phone'
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      } disabled:opacity-50`}
                    >
                      <Phone className="w-5 h-5 inline mr-2" />
                      Phone
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={handleSubmitCredentials}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-3 rounded-xl font-semibold hover:from-purple-700 hover:to-pink-700 transition-all"
              >
                {isLogin ? 'Continue to 2FA' : 'Create Account'}
              </button>
            </div>

            <div className="mt-6 text-center">
              <button
                onClick={() => setIsLogin(!isLogin)}
                className="text-purple-600 font-semibold hover:text-purple-700"
              >
                {isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Login'}
              </button>
            </div>
          </>
        )}

        {step === '2fa' && (
          <>
            <div className="text-center mb-8">
              <div className="bg-gradient-to-r from-blue-600 to-cyan-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-3xl font-bold text-gray-800 mb-2">
                Verify Your Identity
              </h2>
              <p className="text-gray-600">
                We've sent a 6-digit code to your {twoFAMethod === 'email' ? 'email' : 'phone'}
              </p>
              <p className="text-purple-600 font-semibold mt-2">
                {twoFAMethod === 'email' ? formData.email : formData.phone}
              </p>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Enter 6-Digit Code
                </label>
                <input
                  type="text"
                  maxLength="6"
                  value={formData.otp}
                  onChange={(e) => setFormData({ ...formData, otp: e.target.value.replace(/\D/g, '') })}
                  className="w-full px-4 py-3 text-center text-2xl font-bold tracking-widest border-2 border-gray-300 rounded-xl focus:border-purple-500 focus:outline-none"
                  placeholder="000000"
                />
              </div>

              <button
                onClick={handleSubmitOTP}
                className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 text-white py-3 rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-700 transition-all"
              >
                Verify & Continue
              </button>

              <button
                onClick={() => alert('OTP resent!')}
                className="w-full text-purple-600 font-semibold hover:text-purple-700"
              >
                Resend Code
              </button>
            </div>
          </>
        )}

        {step === 'success' && (
          <div className="text-center py-12">
            <div className="bg-gradient-to-r from-green-500 to-emerald-500 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6">
              <Check className="w-12 h-12 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-gray-800 mb-3">
              Verified Successfully!
            </h2>
            <p className="text-gray-600">
              Redirecting to onboarding...
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login2FA;