import { FormEvent, useState } from 'react';
import { AppUser, normalizeUser } from '../utils/userSession';

type AuthProps = {
  onLogin: (user: AppUser) => void;
};

type AuthResponse = {
  success: boolean;
  error?: string;
  token?: string;
  user?: Partial<AppUser> & { id?: string; email?: string };
};

const safeJson = async <T,>(response: Response): Promise<{ data: T | null; rawText: string }> => {
  const rawText = await response.text().catch(() => '');
  try {
    return { data: JSON.parse(rawText) as T, rawText };
  } catch {
    return { data: null, rawText };
  }
};

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com')
  ? ''
  : rawApiBaseUrl.replace(/\/$/, '');

function Auth({ onLogin }: AuthProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Login form state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  // Signup form state
  const [signupName, setSignupName] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');

  const handleLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!loginIdentifier.trim() || !loginPassword.trim()) {
      setErrorMessage('Enter your username or email, then password.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: loginIdentifier.trim(),
          password: loginPassword,
        }),
      });

      const { data: payload, rawText } = await safeJson<AuthResponse>(response);
      if (!payload) {
        throw new Error(`Server error (${response.status}): ${rawText.slice(0, 200) || 'empty response'}`);
      }

      if (!response.ok || !payload.success || !payload.token || !payload.user?.id || !payload.user?.email) {
        throw new Error(payload.error || 'Authentication failed');
      }

      localStorage.setItem('auth_token', payload.token);
      if (rememberMe) {
        localStorage.setItem('remember_login', loginIdentifier.trim());
      }
      onLogin(
        normalizeUser({
          id: payload.user.id,
          email: payload.user.email,
          name: payload.user.name ?? null,
          username: payload.user.username ?? null,
          phone: payload.user.phone ?? null,
          country: payload.user.country ?? null,
          role: payload.user.role === 'admin' ? 'admin' : 'user',
        }),
      );
    } catch (error) {
      const message =
        error instanceof TypeError
          ? 'Backend is unavailable on localhost:5000. Restart the backend and try again.'
          : error instanceof Error
            ? error.message
            : 'Unable to authenticate';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignupSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!signupName.trim() || !signupUsername.trim() || !signupEmail.trim() || !signupPassword.trim()) {
      setErrorMessage('Please fill in all fields.');
      return;
    }

    if (signupPassword !== signupConfirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    if (signupPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: signupName.trim(),
          username: signupUsername.trim(),
          email: signupEmail.trim(),
          password: signupPassword,
        }),
      });

      const { data: payload, rawText } = await safeJson<AuthResponse>(response);
      if (!payload) {
        throw new Error(`Server error (${response.status}): ${rawText.slice(0, 200) || 'empty response'}`);
      }

      if (!response.ok || !payload.success || !payload.token || !payload.user?.id || !payload.user?.email) {
        throw new Error(payload.error || 'Account creation failed');
      }

      localStorage.setItem('auth_token', payload.token);
      onLogin(
        normalizeUser({
          id: payload.user.id,
          email: payload.user.email,
          name: payload.user.name ?? null,
          username: payload.user.username ?? null,
          phone: payload.user.phone ?? null,
          country: payload.user.country ?? null,
          role: 'user',
        }),
      );
    } catch (error) {
      const message =
        error instanceof TypeError
          ? 'Backend is unavailable. Restart the backend and try again.'
          : error instanceof Error
            ? error.message
            : 'Unable to create account';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Left Side - Testimonial */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-gray-800 via-gray-900 to-gray-950 relative overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-72 h-72 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl"></div>
          <div className="absolute bottom-20 right-20 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl"></div>
        </div>
        
        <div className="relative z-10 flex flex-col justify-between p-12">
          <div className="text-white font-bold text-2xl">🌍 Dakyworld</div>
          
          <div className="flex-1 flex flex-col justify-center">
            <blockquote className="text-white text-3xl font-bold leading-tight mb-8 max-w-md">
              "Simply all the tools that my team and I need."
            </blockquote>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-yellow-400 to-orange-400 rounded-full"></div>
              <div>
                <p className="font-semibold text-white">Karen Yue</p>
                <p className="text-gray-300 text-sm">Director of Digital Marketing Technology</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Auth Form */}
      <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-md">
          {mode === 'login' ? (
            // LOGIN FORM
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome back to Dakyworld</h1>
              <p className="text-gray-600 text-sm mb-8">Manage your content and social media effortlessly.</p>

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-xs font-semibold text-gray-700 mb-2">
                    Username or email
                  </label>
                  <input
                    id="email"
                    type="text"
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    placeholder="daky or alex.jordan@gmail.com"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-xs font-semibold text-gray-700 mb-2">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="•••••••"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-600">Remember sign in details</span>
                  </label>
                  <a href="#" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                    Forgot password?
                  </a>
                </div>

                {errorMessage && (
                  <div className="space-y-1">
                    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {errorMessage}
                    </p>
                    <p className="text-xs text-gray-400 px-1">
                      API: {API_BASE_URL || '(none — relative)'}
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg font-semibold hover:from-blue-700 hover:to-blue-800 disabled:opacity-70 disabled:cursor-not-allowed transition-all mt-6"
                >
                  {isSubmitting ? 'Logging in...' : 'Log in'}
                </button>
              </form>

              <div className="mt-6">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-gray-500">or</span>
                  </div>
                </div>
              </div>

              <button className="w-full mt-6 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>

              <p className="text-center text-sm text-gray-600 mt-6">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setErrorMessage(null);
                  }}
                  className="text-blue-600 hover:text-blue-700 font-semibold"
                >
                  Sign up
                </button>
              </p>
            </div>
          ) : (
            // SIGNUP FORM
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Create your account</h1>
              <p className="text-gray-600 text-sm mb-8">Join Dakyworld and manage your social media presence.</p>

              <form onSubmit={handleSignupSubmit} className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-xs font-semibold text-gray-700 mb-2">
                    Name
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={signupName}
                    onChange={(e) => setSignupName(e.target.value)}
                    placeholder="Alex Jordan"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                <div>
                  <label htmlFor="signup-username" className="block text-xs font-semibold text-gray-700 mb-2">
                    Username
                  </label>
                  <input
                    id="signup-username"
                    type="text"
                    value={signupUsername}
                    onChange={(e) => setSignupUsername(e.target.value)}
                    placeholder="alex.jordan"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                <div>
                  <label htmlFor="signup-email" className="block text-xs font-semibold text-gray-700 mb-2">
                    Email
                  </label>
                  <input
                    id="signup-email"
                    type="email"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    placeholder="alex.jordan@gmail.com"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                <div>
                  <label htmlFor="signup-password" className="block text-xs font-semibold text-gray-700 mb-2">
                    Password
                  </label>
                  <input
                    id="signup-password"
                    type="password"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder="•••••••"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                <div>
                  <label htmlFor="confirm-password" className="block text-xs font-semibold text-gray-700 mb-2">
                    Confirm password
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    value={signupConfirmPassword}
                    onChange={(e) => setSignupConfirmPassword(e.target.value)}
                    placeholder="•••••••"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                {errorMessage && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {errorMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg font-semibold hover:from-blue-700 hover:to-blue-800 disabled:opacity-70 disabled:cursor-not-allowed transition-all mt-6"
                >
                  {isSubmitting ? 'Creating account...' : 'Create account'}
                </button>
              </form>

              <div className="mt-6">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-gray-500">or</span>
                  </div>
                </div>
              </div>

              <button className="w-full mt-6 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign up with Google
              </button>

              <p className="text-center text-sm text-gray-600 mt-6">
                Have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMessage(null);
                  }}
                  className="text-blue-600 hover:text-blue-700 font-semibold"
                >
                  Log in
                </button>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Auth;
