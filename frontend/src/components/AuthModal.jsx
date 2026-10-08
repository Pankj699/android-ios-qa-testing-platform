import React, { useState, useEffect } from 'react';
import { Key, Lock, Mail, AlertCircle, X, CheckCircle2, Shield, User, ArrowRight, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { api } from '../services/api';

const REMEMBERED_EMAIL_KEY = 'qa_remembered_email';

export default function AuthModal({ isOpen, onClose, onLoginSuccess, initialMode = 'login', initialToken = '' }) {
  const [mode, setMode] = useState(initialMode); // 'login' | 'register' | 'forgot' | 'reset'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState(initialToken);
  
  // Independent password visibility states
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);

  // Remember Me state for Sign In
  const [rememberMe, setRememberMe] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode || 'login');
      setError('');
      setSuccessMessage('');
      if (initialToken) setResetToken(initialToken);

      // Check for remembered email on open
      try {
        const savedEmail = localStorage.getItem(REMEMBERED_EMAIL_KEY);
        if (savedEmail) {
          setEmail(savedEmail);
          setRememberMe(true);
        } else {
          setRememberMe(false);
        }
      } catch (e) {}

      // Reset visibility toggles to default hidden state
      setShowLoginPassword(false);
      setShowRegisterPassword(false);
      setShowRegisterConfirmPassword(false);
      setShowResetPassword(false);
      setShowResetConfirmPassword(false);
    }
  }, [isOpen, initialMode, initialToken]);

  if (!isOpen) return null;

  const resetErrors = () => {
    setError('');
    setSuccessMessage('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    resetErrors();

    const form = e.currentTarget;
    const currentEmail = (email || form.elements?.email?.value || '').trim();
    const currentPassword = password || form.elements?.password?.value || '';

    if (!currentEmail) {
      setError('Email address is required.');
      return;
    }
    if (!currentPassword) {
      setError('Password is required.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.login({ email: currentEmail, password: currentPassword });
      if (res.success && res.user) {
        // Handle Remember Me: store only email locally (NEVER password)
        try {
          if (rememberMe) {
            localStorage.setItem(REMEMBERED_EMAIL_KEY, currentEmail);
          } else {
            localStorage.removeItem(REMEMBERED_EMAIL_KEY);
          }
        } catch (e) {}

        if (onLoginSuccess) {
          onLoginSuccess(res.user);
        }
        if (onClose) onClose();
      } else {
        setError(res.error || 'Authentication failed. Please verify your credentials.');
      }
    } catch (err) {
      setError(err.message || 'Authentication failed. Please verify your email and password.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    resetErrors();

    const form = e.currentTarget;
    const trimmedName = (name || form.elements?.name?.value || '').trim();
    const normalizedEmail = (email || form.elements?.email?.value || '').trim();
    const currentPassword = password || form.elements?.password?.value || '';
    const currentConfirmPassword = confirmPassword || form.elements?.confirmPassword?.value || '';

    if (!trimmedName || trimmedName.length < 2) {
      setError('Please enter your full name (minimum 2 characters).');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!currentPassword || currentPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (currentPassword.length > 128) {
      setError('Password cannot exceed 128 characters.');
      return;
    }

    if (currentPassword !== currentConfirmPassword) {
      setError('Passwords do not match. Please re-enter your password.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.register({
        name: trimmedName,
        email: normalizedEmail,
        password: currentPassword
      });

      if (res.success && res.user) {
        if (onLoginSuccess) {
          onLoginSuccess(res.user);
        }
        if (onClose) onClose();
      } else {
        setError(res.error || 'Registration failed. Please try again.');
      }
    } catch (err) {
      setError(err.message || 'Registration failed. Please check your details.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    resetErrors();

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError('Please enter your account email address.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.forgotPassword(normalizedEmail);
      setSuccessMessage(res.message || 'If an account exists with that email address, password reset instructions have been sent.');
      if (res.devResetToken) {
        setResetToken(res.devResetToken);
      }
    } catch (err) {
      setError(err.message || 'Failed to submit reset request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    resetErrors();

    const trimmedToken = resetToken.trim();
    if (!trimmedToken) {
      setError('Password reset token is required.');
      return;
    }

    if (!password || password.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }

    if (password.length > 128) {
      setError('New password cannot exceed 128 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter your new password.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.resetPassword({
        token: trimmedToken,
        newPassword: password
      });

      setSuccessMessage('Password has been successfully reset! Please sign in with your new password.');
      setPassword('');
      setConfirmPassword('');
      setResetToken('');
    } catch (err) {
      setError(err.message || 'Password reset failed. The token may be invalid or expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-md bg-[#0D111A] border border-[#1E2638] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header Banner */}
        <div className="p-6 border-b border-[#1E2638] bg-[#131924]/80 flex items-start justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-[#261D10] border border-[#F59E0B]/40 flex items-center justify-center text-[#F59E0B] shadow-inner">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#FFFFFF] tracking-tight">QA Testing Platform</h2>
              <p className="text-xs text-[#94A3B8]">
                {mode === 'login' && 'Sign in to access devices, builds, and test runs'}
                {mode === 'register' && 'Create a new QA Tester account'}
                {mode === 'forgot' && 'Reset your account password'}
                {mode === 'reset' && 'Set a new secure password'}
              </p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[#1E2638] text-[#94A3B8] hover:text-[#FFFFFF] transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tab Switcher (Login vs Register) */}
        {(mode === 'login' || mode === 'register') && (
          <div className="flex border-b border-[#1E2638] bg-[#0A0D14]">
            <button
              onClick={() => { setMode('login'); resetErrors(); }}
              className={`flex-1 py-3 text-xs font-semibold transition-colors border-b-2 ${
                mode === 'login' ? 'border-[#F59E0B] text-[#F59E0B] bg-[#131924]/60' : 'border-transparent text-[#94A3B8] hover:text-[#FFFFFF]'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('register'); resetErrors(); }}
              className={`flex-1 py-3 text-xs font-semibold transition-colors border-b-2 ${
                mode === 'register' ? 'border-[#F59E0B] text-[#F59E0B] bg-[#131924]/60' : 'border-transparent text-[#94A3B8] hover:text-[#FFFFFF]'
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        {/* Error Notification */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-start gap-2 leading-relaxed">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Success Notification */}
        {successMessage && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-start gap-2 leading-relaxed">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Body Content */}
        <div className="p-6 pt-4 space-y-4">
          {/* 1. SIGN IN FORM */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="login-email" className="text-xs font-medium text-[#CBD5E1]">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    required
                    autoComplete="username"
                    className="w-full pl-9 pr-3 py-2 bg-[#0A0D14] border border-[#1E2638] rounded-lg text-xs text-[#FFFFFF] placeholder-[#475569] focus:outline-none focus:border-[#F59E0B]"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="login-password" className="text-xs font-medium text-[#CBD5E1]">Password</label>
                <div className="relative">
                  <Key className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-password"
                    name="password"
                    type={showLoginPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    autoComplete="current-password"
                    className="w-full pl-9 pr-10 py-2 bg-[#0A0D14] border border-[#1E2638] rounded-lg text-xs text-[#FFFFFF] placeholder-[#475569] focus:outline-none focus:border-[#F59E0B]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#CBD5E1] focus:text-[#F59E0B] focus:outline-none p-1 rounded transition-colors cursor-pointer"
                    aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                    title={showLoginPassword ? 'Hide password' : 'Show password'}
                    tabIndex={0}
                  >
                    {showLoginPassword ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              {/* Remember Me and Forgot Password Row */}
              <div className="flex items-center justify-between pt-0.5">
                <label htmlFor="remember-me" className="flex items-center gap-2 cursor-pointer select-none text-xs text-[#CBD5E1] hover:text-[#FFFFFF] transition-colors">
                  <input
                    type="checkbox"
                    id="remember-me"
                    name="rememberMe"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-3.5 h-3.5 rounded bg-[#0A0D14] border border-[#1E2638] text-[#F59E0B] focus:ring-1 focus:ring-[#F59E0B] focus:ring-offset-0 focus:outline-none accent-[#F59E0B] cursor-pointer"
                  />
                  <span>Remember me</span>
                </label>
                <button
                  type="button"
                  onClick={() => { setMode('forgot'); resetErrors(); }}
                  className="text-[11px] text-[#F59E0B] hover:underline transition-all"
                >
                  Forgot Password?
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-xs font-bold text-[#000000] shadow transition-all flex items-center justify-center gap-2 mt-2 cursor-pointer"
              >
                {loading ? 'Authenticating...' : 'Sign In'}
              </button>

              <div className="pt-2 text-center text-xs text-[#94A3B8]">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => { setMode('register'); resetErrors(); }}
                  className="text-[#F59E0B] font-semibold hover:underline"
                >
                  Create Account
                </button>
              </div>
            </form>
          )}

          {/* 2. REGISTER FORM */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div className="space-y-1">
                <label htmlFor="register-name" className="text-xs font-medium text-[#CBD5E1]">Full Name</label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="register-name"
                    name="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Jane Doe"
                    required
                    autoComplete="name"
                    className="w-full pl-9 pr-3 py-2 bg-[#0A0D14] border border-[#1E2638] rounded-lg text-xs text-[#FFFFFF] placeholder-[#475569] focus:outline-none focus:border-[#F59E0B]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="register-email" className="text-xs font-medium text-[#CBD5E1]">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="register-email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    required
                    autoComplete="username"
                    className="w-full pl-9 pr-3 py-2 bg-[#0A0D14] border border-[#1E2638] rounded-lg text-xs text-[#FFFFFF] placeholder-[#475569] focus:outline-none focus:border-[#F59E0B]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="register-password" className="text-xs font-medium text-[#CBD5E1]">Password (min. 8 characters)</label>
                <div className="relative">
                  <Key className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="register-password"
                    name="password"
                    type={showRegisterPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a secure password"
                    required
                    autoComplete="new-password"
                    className="w-full pl-9 pr-10 py-2 bg-[#0A0D14] border border-[#1E2638] rounded-lg text-xs text-[#FFFFFF] placeholder-[#475569] focus:outline-none focus:border-[#F59E0B]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegisterPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#CBD5E1] focus:text-[#F59E0B] focus:outline-none p-1 rounded transition-colors cursor-pointer"
                    aria-label={showRegisterPassword ? 'Hide password' : 'Show password'}
                    title={showRegisterPassword ? 'Hide password' : 'Show password'}
                    tabIndex={0}
                  >
                    {showRegisterPassword ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="register-confirm-password" className="text-xs font-medium text-[#CBD5E1]">Confirm Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="register-confirm-password"
                    name="confirmPassword"
                    type={showRegisterConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    required
                    autoComplete="new-password"
                    className="w-full pl-9 pr-10 py-2 bg-[#0A0D14] border border-[#1E2638] rounded-lg text-xs text-[#FFFFFF] placeholder-[#475569] focus:outline-none focus:border-[#F59E0B]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegisterConfirmPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#CBD5E1] focus:text-[#F59E0B] focus:outline-none p-1 rounded transition-colors cursor-pointer"
                    aria-label={showRegisterConfirmPassword ? 'Hide password' : 'Show password'}
                    title={showRegisterConfirmPassword ? 'Hide password' : 'Show password'}
                    tabIndex={0}
                  >
                    {showRegisterConfirmPassword ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-xs font-bold text-[#000000] shadow transition-all flex items-center justify-center gap-2 mt-2 cursor-pointer"
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>

              <div className="pt-2 text-center text-xs text-[#94A3B8]">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => { setMode('login'); resetErrors(); }}
                  className="text-[#F59E0B] font-semibold hover:underline"
                >
                  Sign In
                </button>
              </div>
            </form>
          )}

          {/* 3. FORGOT PASSWORD FORM */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#CBD5E1]">Registered Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your registered email"
                    required
                    autoComplete="email"
                    className="w-full pl-9 pr-3 py-2 bg-[#0A0D14] border border-[#1E2638] rounded-lg text-xs text-[#FFFFFF] placeholder-[#475569] focus:outline-none focus:border-[#F59E0B]"
                  />
                </div>
                <p className="text-[11px] text-[#64748B] pt-1">
                  We'll generate single-use reset instructions for your account.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-2.5 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-xs font-bold text-[#000000] shadow transition-all flex items-center justify-center gap-2"
              >
                {loading ? 'Sending Instructions...' : 'Send Reset Link'}
              </button>

              <div className="flex items-center justify-between text-xs pt-2">
                <button
                  type="button"
                  onClick={() => { setMode('login'); resetErrors(); }}
                  className="text-[#94A3B8] hover:text-[#FFFFFF] flex items-center gap-1 transition-colors"
                >
                  <ArrowLeft className="w-3 h-3" />
                  <span>Back to Sign In</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setMode('reset'); resetErrors(); }}
                  className="text-[#F59E0B] hover:underline"
                >
                  Have a reset token?
                </button>
              </div>
            </form>
          )}

          {/* 4. RESET PASSWORD FORM */}
          {mode === 'reset' && (
            <div className="space-y-4">
              {successMessage ? (
                <div className="space-y-4 text-center py-2">
                  <button
                    onClick={() => { setMode('login'); resetErrors(); }}
                    className="w-full py-2.5 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-[#000000] shadow transition-all"
                  >
                    Proceed to Sign In
                  </button>
                </div>
              ) : (
                <form onSubmit={handleResetPassword} className="space-y-3.5">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[#CBD5E1]">Reset Token</label>
                    <input
                      type="text"
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      placeholder="Paste 64-character reset token"
                      required
                      className="w-full px-3 py-2 bg-[#0A0D14] border border-[#1E2638] rounded-lg text-xs font-mono text-[#FFFFFF] placeholder-[#475569] focus:outline-none focus:border-[#F59E0B]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="reset-new-password" className="text-xs font-medium text-[#CBD5E1]">New Password</label>
                    <div className="relative">
                      <Key className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="reset-new-password"
                        name="password"
                        type={showResetPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        required
                        autoComplete="new-password"
                        className="w-full pl-9 pr-10 py-2 bg-[#0A0D14] border border-[#1E2638] rounded-lg text-xs text-[#FFFFFF] placeholder-[#475569] focus:outline-none focus:border-[#F59E0B]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowResetPassword((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#CBD5E1] focus:text-[#F59E0B] focus:outline-none p-1 rounded transition-colors cursor-pointer"
                        aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                        title={showResetPassword ? 'Hide password' : 'Show password'}
                        tabIndex={0}
                      >
                        {showResetPassword ? (
                          <EyeOff className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <Eye className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="reset-confirm-password" className="text-xs font-medium text-[#CBD5E1]">Confirm New Password</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="reset-confirm-password"
                        name="confirmPassword"
                        type={showResetConfirmPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm your new password"
                        required
                        autoComplete="new-password"
                        className="w-full pl-9 pr-10 py-2 bg-[#0A0D14] border border-[#1E2638] rounded-lg text-xs text-[#FFFFFF] placeholder-[#475569] focus:outline-none focus:border-[#F59E0B]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowResetConfirmPassword((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#CBD5E1] focus:text-[#F59E0B] focus:outline-none p-1 rounded transition-colors cursor-pointer"
                        aria-label={showResetConfirmPassword ? 'Hide password' : 'Show password'}
                        title={showResetConfirmPassword ? 'Hide password' : 'Show password'}
                        tabIndex={0}
                      >
                        {showResetConfirmPassword ? (
                          <EyeOff className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <Eye className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-xs font-bold text-[#000000] shadow transition-all flex items-center justify-center gap-2 mt-2 cursor-pointer"
                  >
                    {loading ? 'Resetting Password...' : 'Reset Password'}
                  </button>

                  <div className="pt-2 text-center text-xs">
                    <button
                      type="button"
                      onClick={() => { setMode('login'); resetErrors(); }}
                      className="text-[#94A3B8] hover:text-[#FFFFFF] inline-flex items-center gap-1 transition-colors"
                    >
                      <ArrowLeft className="w-3 h-3" />
                      <span>Back to Sign In</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="pt-2 text-center">
            <p className="text-[11px] text-[#64748B]">
              Only authenticated users can upload builds, claim hardware, and execute PAD automation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
