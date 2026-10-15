import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Eye, EyeOff, Mail, ArrowLeft, KeyRound, ArrowRight, FileText } from 'lucide-react';
import { LandingPage } from './LandingPage';
import { getLandingPlanDisplay } from './landingPlans';
import { getErrorMessage, getRawErrorMessage } from '../utils/errors';
import { TurnstileWidget, type TurnstileHandle } from './TurnstileWidget';
import { LegalLinks } from './legal/LegalPage';
import { LEGAL_PATHS } from '../legal/paths';
import { TERMS_VERSION, PRIVACY_VERSION } from '../legal/versions';

const SIGNUP_NEUTRAL_MESSAGE =
  'Thanks! If this email address is new, your account has been created. Please sign in to continue.';

interface AuthProps {
  showResetPassword?: boolean;
}

export function Auth({ showResetPassword }: AuthProps) {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [selectedBilling, setSelectedBilling] = useState<'monthly' | 'annually'>('monthly');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const captchaRef = useRef<TurnstileHandle>(null);

  // Turnstile tokens are single-use, so every attempt needs a fresh one.
  const resetCaptcha = () => captchaRef.current?.reset();

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captchaToken) return;
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
      if (error) throw error;
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      resetCaptcha();
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (!captchaToken || !agreedToTerms) return;
    setLoading(true);
    setError('');
    try {
      const legalData = { terms_accepted: true, terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION };
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          captchaToken,
          data: selectedPlan
            ? { ...legalData, plan_key: selectedPlan, billing_cycle: selectedBilling }
            : legalData,
        },
      });
      if (error) throw error;
      if (selectedPlan) {
        try {
          localStorage.setItem('pendingPlan', JSON.stringify({ plan_key: selectedPlan, billing_cycle: selectedBilling }));
        } catch {
          // localStorage may be unavailable in some environments
        }
      }
      // Deliberately identical to the "email already registered" outcome below
      // so the form cannot be used to discover which addresses have accounts.
      setSuccess(SIGNUP_NEUTRAL_MESSAGE);
    } catch (err) {
      const raw = getRawErrorMessage(err).toLowerCase();
      const isExistingAccount =
        raw.includes('already registered') ||
        raw.includes('already been registered') ||
        raw.includes('user already exists') ||
        raw.includes('email address is already');
      if (isExistingAccount) {
        setSuccess(SIGNUP_NEUTRAL_MESSAGE);
      } else {
        setError(getErrorMessage(err, 'We could not complete the sign up. Please try again.'));
      }
    } finally {
      setLoading(false);
      resetCaptcha();
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captchaToken) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
        captchaToken,
      });
      if (error) throw error;
      setSuccess('Password reset link sent. Please check your inbox.');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      resetCaptcha();
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (newPassword.length < 12) { setError('Password must be at least 12 characters.'); return; }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setSuccess('Password updated successfully. You are now logged in.');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPlan = (planKey: string, billing: 'monthly' | 'annually') => {
    setSelectedPlan(planKey);
    setSelectedBilling(billing);
    setMode('signup');
    setError('');
    setSuccess('');
  };

  if (showResetPassword) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-blue-600 p-3 rounded-xl">
              <KeyRound className="w-7 h-7 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center mb-1 text-slate-900">Set New Password</h1>
          <p className="text-center text-slate-500 text-sm mb-7">Enter your new password below.</p>
          <form onSubmit={handleResetPassword} className="space-y-4">
            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
            {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">New Password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={12}
                  className="w-full px-4 py-2.5 pr-12 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" placeholder="••••••••" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600">
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Confirm Password</label>
              <input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={12}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading || !!success}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50">
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: '#0f1623' }}>
      {/* Left panel — pricing */}
      <div className="hidden lg:flex flex-col w-[58%] min-h-screen bg-[#0d1421] border-r border-slate-800 overflow-y-auto">
        <LandingPage onSelectPlan={handleSelectPlan} />
      </div>

      {/* Right panel — auth */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white min-h-screen">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8">
            <div className="flex items-center gap-2">
              <div className="bg-blue-600 p-2 rounded-xl">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold text-slate-900">Lease Accountant</span>
            </div>
            <p className="text-sm text-slate-500 mt-1 pl-10">
              Product of{' '}
              <a
                href="https://www.ms-consult.us"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-600 hover:text-slate-900 hover:underline transition ml-1"
              >
                www.ms-consult.us
              </a>
            </p>
          </div>

          {mode === 'login' && (
            <>
              <h2 className="text-3xl font-bold text-slate-900 mb-1">Welcome back</h2>
              <p className="text-slate-500 text-sm mb-8">Sign in to your Lease Accountant account</p>

              <form onSubmit={handleSignIn} className="space-y-5">
                {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Work Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                      className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-slate-50 text-slate-900 placeholder:text-slate-500"
                      placeholder="you@company.com" />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-semibold text-slate-700">Password</label>
                    <button type="button" onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium transition">
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </span>
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                      className="w-full pl-10 pr-12 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-slate-50 text-slate-900 placeholder:text-slate-500"
                      placeholder="••••••••" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <TurnstileWidget ref={captchaRef} onToken={setCaptchaToken} action="login" />

                <button type="submit" disabled={loading || !captchaToken}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2 text-base">
                  {loading ? 'Signing in...' : (<>Sign In <ArrowRight className="w-4 h-4" /></>)}
                </button>
              </form>

              <p className="text-center text-sm text-slate-500 mt-6">
                Don't have an account?{' '}
                <button onClick={() => { setMode('signup'); setError(''); setSuccess(''); }}
                  className="text-blue-600 hover:text-blue-800 font-semibold transition">
                  Start free trial
                </button>
              </p>
            </>
          )}

          {mode === 'signup' && (
            <>
              <div className="flex items-start gap-3 mb-6">
                <button onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
                  className="mt-1 text-slate-500 hover:text-slate-600 transition flex-shrink-0"
                  aria-label="Back to sign in"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Start free trial</h2>
                  {selectedPlan && (() => {
                    const display = getLandingPlanDisplay(selectedPlan, selectedBilling);
                    return (
                      <p className="text-sm text-slate-500 mt-0.5">
                        {display ? `${display.name} plan — ${display.priceLabel}` : `${selectedPlan} plan`}
                      </p>
                    );
                  })()}
                </div>
              </div>

              <form onSubmit={handleSignUp} className="space-y-5">
                {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
                {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>}

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Work Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                      className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-slate-50 text-slate-900 placeholder:text-slate-500"
                      placeholder="you@company.com" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Password</label>
                  <div className="relative">
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={12}
                      className="w-full px-4 pr-12 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-slate-50 text-slate-900 placeholder:text-slate-500"
                      placeholder="Min. 12 characters" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <TurnstileWidget ref={captchaRef} onToken={setCaptchaToken} action="signup" />

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreedToTerms}
                    onChange={e => setAgreedToTerms(e.target.checked)}
                    required
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-600 leading-relaxed">
                    I agree to the{' '}
                    <a href={LEGAL_PATHS.terms} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 font-medium underline">Terms of Service</a>
                    {' '}and{' '}
                    <a href={LEGAL_PATHS.privacy} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 font-medium underline">Privacy Policy</a>
                  </span>
                </label>

                <button type="submit" disabled={loading || !!success || !captchaToken || !agreedToTerms}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2 text-base">
                  {loading ? 'Creating account...' : (<>Create Account <ArrowRight className="w-4 h-4" /></>)}
                </button>
              </form>

              <p className="text-center text-xs text-slate-500 mt-5">
                5-day free trial &middot; No credit card required &middot; Cancel anytime
              </p>
              <p className="text-center text-sm text-slate-500 mt-3">
                Already have an account?{' '}
                <button onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
                  className="text-blue-600 hover:text-blue-800 font-semibold transition">
                  Sign in
                </button>
              </p>
            </>
          )}

          {mode === 'forgot' && (
            <>
              <div className="flex items-start gap-3 mb-6">
                <button onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
                  className="mt-1 text-slate-500 hover:text-slate-600 transition flex-shrink-0"
                  aria-label="Back to sign in"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Reset Password</h2>
                  <p className="text-sm text-slate-500 mt-0.5">Enter your email to receive a reset link</p>
                </div>
              </div>

              <form onSubmit={handleForgotPassword} className="space-y-5">
                {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
                {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>}

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                      className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-slate-50 text-slate-900 placeholder:text-slate-500"
                      placeholder="you@company.com" />
                  </div>
                </div>

                <TurnstileWidget ref={captchaRef} onToken={setCaptchaToken} action="reset_request" />

                <button type="submit" disabled={loading || !!success || !captchaToken}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition disabled:opacity-50">
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>
            </>
          )}

          <footer className="mt-10 pt-6 border-t border-slate-100 text-center text-xs text-slate-500">
            <LegalLinks />
          </footer>
        </div>
      </div>
    </div>
  );
}
