import { FormEvent, useState } from 'react';
import { AppUser, normalizeUser } from '../utils/userSession';

type AuthProps = {
  onLogin: (user: AppUser) => void;
};

type AuthMode = 'login' | 'signup';

type AuthResponse = {
  success: boolean;
  error?: string;
  token?: string;
  user?: Partial<AppUser> & { id?: string; email?: string };
};

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com')
  ? ''
  : rawApiBaseUrl.replace(/\/$/, '');

function Auth({ onLogin }: AuthProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [signupName, setSignupName] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');

  const isSignup = mode === 'signup';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (isSignup) {
      if (!signupName.trim() || !signupUsername.trim() || !signupEmail.trim() || !signupPassword.trim()) {
        setErrorMessage('Please complete all signup fields.');
        return;
      }

      if (signupPassword.length < 6) {
        setErrorMessage('Password must be at least 6 characters.');
        return;
      }

      if (signupPassword !== signupConfirmPassword) {
        setErrorMessage('Passwords do not match.');
        return;
      }
    } else if (!loginIdentifier.trim() || !loginPassword.trim()) {
      setErrorMessage('Enter your username or email, then password.');
      return;
    }

    setIsSubmitting(true);

    try {
      const endpoint = isSignup ? '/api/auth/register' : '/api/auth/login';
      const body = isSignup
        ? {
            name: signupName.trim(),
            username: signupUsername.trim(),
            email: signupEmail.trim(),
            password: signupPassword,
          }
        : {
            identifier: loginIdentifier.trim(),
            password: loginPassword,
          };

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as AuthResponse;
      if (
        !response.ok ||
        !payload.success ||
        !payload.token ||
        !payload.user?.id ||
        !payload.user?.email
      ) {
        throw new Error(payload.error || 'Authentication failed');
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
        })
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to authenticate');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-black text-gray-900">Dakyworld hub</h1>
          <p className="text-sm text-gray-600 mt-2">
            {isSignup ? 'Create your account' : 'Sign in with username or email'}
          </p>
        </div>

        <div className="grid grid-cols-2 bg-gray-100 rounded-lg p-1 mb-6">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMessage(null);
            }}
            className={`py-2 rounded-md text-sm font-semibold transition-colors ${
              !isSignup ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setErrorMessage(null);
            }}
            className={`py-2 rounded-md text-sm font-semibold transition-colors ${
              isSignup ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignup ? (
            <>
              <div>
                <label htmlFor="signup-name" className="block text-sm font-semibold text-gray-700 mb-1">
                  Name
                </label>
                <input
                  id="signup-name"
                  type="text"
                  value={signupName}
                  onChange={(event) => setSignupName(event.target.value)}
                  autoComplete="name"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label
                  htmlFor="signup-username"
                  className="block text-sm font-semibold text-gray-700 mb-1"
                >
                  Username
                </label>
                <input
                  id="signup-username"
                  type="text"
                  value={signupUsername}
                  onChange={(event) => setSignupUsername(event.target.value)}
                  autoComplete="username"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="signup-email" className="block text-sm font-semibold text-gray-700 mb-1">
                  Email
                </label>
                <input
                  id="signup-email"
                  type="email"
                  value={signupEmail}
                  onChange={(event) => setSignupEmail(event.target.value)}
                  autoComplete="email"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label
                  htmlFor="signup-password"
                  className="block text-sm font-semibold text-gray-700 mb-1"
                >
                  Password
                </label>
                <input
                  id="signup-password"
                  type="password"
                  value={signupPassword}
                  onChange={(event) => setSignupPassword(event.target.value)}
                  autoComplete="new-password"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label
                  htmlFor="signup-confirm-password"
                  className="block text-sm font-semibold text-gray-700 mb-1"
                >
                  Confirm password
                </label>
                <input
                  id="signup-confirm-password"
                  type="password"
                  value={signupConfirmPassword}
                  onChange={(event) => setSignupConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label
                  htmlFor="login-identifier"
                  className="block text-sm font-semibold text-gray-700 mb-1"
                >
                  Username or email
                </label>
                <input
                  id="login-identifier"
                  type="text"
                  value={loginIdentifier}
                  onChange={(event) => setLoginIdentifier(event.target.value)}
                  autoComplete="username"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label
                  htmlFor="login-password"
                  className="block text-sm font-semibold text-gray-700 mb-1"
                >
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  autoComplete="current-password"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {errorMessage && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? 'Please wait...' : isSignup ? 'Create account' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Auth;
