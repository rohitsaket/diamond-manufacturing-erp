import { useState, useRef, FormEvent } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false });
  const emailRef = useRef<HTMLInputElement>(null);

  const emailError = touched.email && !email.trim() ? 'Email is required' : '';
  const passwordError = touched.password && !password.trim() ? 'Password is required' : '';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, password: true });
    setError('');

    if (!email.trim() || !password.trim()) return;

    setLoading(true);
    try {
      const result = await login(email, password);
      if (!result.success) {
        setError(result.error || 'Invalid credentials');
      }
    } catch {
      setError('Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#F8FAFC' }}>
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden bg-[#0F172A] flex-col justify-between p-12">
        <div className="absolute inset-0 opacity-[0.03]">
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <pattern id="diamond-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <polygon points="10,0 20,10 10,20 0,10" fill="white" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#diamond-grid)" />
          </svg>
        </div>

        <div className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M6.5 2h11l4.5 6L12 22 2 8l4.5-6z" opacity={0.95}/>
                </svg>
              </div>
              <div>
                <h1 className="text-white font-semibold text-lg tracking-tight">DiamondMatrix</h1>
                <p className="text-white/40 text-xs uppercase tracking-widest font-medium">Enterprise ERP</p>
              </div>
            </div>
          </motion.div>
        </div>

        <div className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
          >
            <blockquote className="border-l-2 border-white/20 pl-5">
              <p className="text-white/80 text-lg font-light leading-relaxed">
                "Precision in every cut.<br />Clarity in every decision."
              </p>
              <footer className="text-white/30 text-sm mt-3 font-medium">
                DiamondMatrix Enterprise Solutions
              </footer>
            </blockquote>
          </motion.div>
        </div>

        <div className="relative z-10">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.6, ease: 'easeOut' }}
          >
            <div className="flex gap-6">
              {['IGI', 'GIA', 'BIS'].map((cert) => (
                <div
                  key={cert}
                  className="px-4 py-2 rounded-md border border-white/10 bg-white/5"
                >
                  <p className="text-white/30 text-[10px] uppercase tracking-widest font-medium">{cert}</p>
                  <p className="text-white/50 text-xs font-semibold mt-0.5">Certified</p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Login panel */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="w-full max-w-sm"
        >
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-9 h-9 rounded-lg bg-[#0F172A] flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <path d="M6.5 2h11l4.5 6L12 22 2 8l4.5-6z" opacity={0.95}/>
              </svg>
            </div>
            <div>
              <h1 className="text-[#111827] font-semibold text-base tracking-tight">DiamondMatrix</h1>
              <p className="text-[#6B7280] text-[10px] uppercase tracking-widest font-medium">Enterprise ERP</p>
            </div>
          </div>

          {/* Heading */}
          <h2 className="text-[#111827] text-2xl font-semibold tracking-tight">Welcome back</h2>
          <p className="text-[#6B7280] text-sm mt-1.5 mb-8">Sign in to your account to continue</p>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] flex items-start gap-2.5"
            >
              <svg className="w-4 h-4 text-[#DC2626] mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[#DC2626] text-sm">{error}</p>
            </motion.div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            {/* Email */}
            <div className="mb-4">
              <label htmlFor="email" className="block text-[#111827] text-sm font-medium mb-1.5">
                Email address
              </label>
              <input
                ref={emailRef}
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
                disabled={loading}
                aria-invalid={!!emailError || undefined}
                aria-describedby={emailError ? 'email-error' : undefined}
                className={`w-full h-11 px-3.5 rounded-lg border bg-white text-[#111827] text-sm placeholder:text-[#9CA3AF] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] ${
                  emailError ? 'border-[#DC2626]' : 'border-[#E5E7EB] hover:border-[#9CA3AF]'
                }`}
              />
              {emailError && (
                <p id="email-error" className="text-[#DC2626] text-xs mt-1" role="alert">
                  {emailError}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="mb-5">
              <label htmlFor="password" className="block text-[#111827] text-sm font-medium mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                  disabled={loading}
                  aria-invalid={!!passwordError || undefined}
                  aria-describedby={passwordError ? 'password-error' : undefined}
                  className={`w-full h-11 px-3.5 rounded-lg border bg-white text-[#111827] text-sm placeholder:text-[#9CA3AF] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] pr-10 ${
                    passwordError ? 'border-[#DC2626]' : 'border-[#E5E7EB] hover:border-[#9CA3AF]'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#9CA3AF] hover:text-[#6B7280] transition-colors disabled:opacity-50"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {passwordError && (
                <p id="password-error" className="text-[#DC2626] text-xs mt-1" role="alert">
                  {passwordError}
                </p>
              )}
            </div>

            {/* Remember + Forgot */}
            <div className="flex items-center justify-between mb-6">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  disabled={loading}
                  className="w-4 h-4 rounded border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB]/20 focus:ring-2 disabled:opacity-50"
                />
                <span className="text-[#6B7280] text-sm">Remember me</span>
              </label>
              <button
                type="button"
                disabled={loading}
                onClick={() => window.alert('Password reset is not yet configured. Contact your administrator.')}
                className="text-[#2563EB] text-sm font-medium hover:text-[#1D4ED8] transition-colors disabled:opacity-50"
              >
                Forgot password?
              </button>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-lg bg-[#2563EB] text-white text-sm font-semibold hover:bg-[#1D4ED8] disabled:bg-[#93C5FD] disabled:cursor-not-allowed transition-colors duration-150 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
            >
              {loading && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          {/* Footer */}
          <p className="text-center text-[#9CA3AF] text-xs mt-8">
            &copy; {new Date().getFullYear()} DiamondMatrix Enterprise Solutions. All rights reserved.
          </p>
          <p className="text-center text-[#D1D5DB] text-[10px] mt-1">DiamondMatrix ERP v2.0</p>
        </motion.div>
      </div>
    </div>
  );
}