import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Save } from 'lucide-react';
import { AppUser, normalizeUser } from '../utils/userSession';

type ProfileProps = {
  currentUser: AppUser | null;
  onUserUpdated: (user: AppUser) => void;
};

type ProfileForm = {
  name: string;
  username: string;
  email: string;
  phone: string;
  country: string;
};

type ProfileResponse = {
  success: boolean;
  error?: string;
  user?: Partial<AppUser> & { id?: string; email?: string };
};

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com')
  ? ''
  : rawApiBaseUrl.replace(/\/$/, '');

const PROFILE_FIELDS: Array<{ key: keyof ProfileForm; label: string; type: string; autoComplete: string }> = [
  { key: 'name', label: 'Name', type: 'text', autoComplete: 'name' },
  { key: 'username', label: 'Username', type: 'text', autoComplete: 'username' },
  { key: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
  { key: 'country', label: 'Country', type: 'text', autoComplete: 'country-name' },
];

function toProfileForm(user: AppUser | null): ProfileForm {
  return {
    name: user?.name ?? '',
    username: user?.username ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    country: user?.country ?? '',
  };
}

function Profile({ currentUser, onUserUpdated }: ProfileProps) {
  const [form, setForm] = useState<ProfileForm>(() => toProfileForm(currentUser));
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setForm(toProfileForm(currentUser));
  }, [currentUser]);

  const missingFields = useMemo(() => {
    return PROFILE_FIELDS.filter((field) => !form[field.key].trim()).map((field) => field.label);
  }, [form]);

  const inputClass = (value: string) =>
    `w-full px-4 py-2 border rounded-lg focus:outline-none ${
      value.trim()
        ? 'border-gray-300 focus:ring-2 focus:ring-blue-500'
        : 'border-red-500 focus:ring-2 focus:ring-red-300 bg-red-50'
    }`;

  const handleChange = (field: keyof ProfileForm, value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setSuccessMessage(null);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!form.name.trim() || !form.username.trim() || !form.email.trim()) {
      setErrorMessage('Name, username, and email are required.');
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) {
      setErrorMessage('Your session expired. Please log in again.');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: form.name.trim(),
          username: form.username.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          country: form.country.trim(),
        }),
      });

      const payload = (await response.json()) as ProfileResponse;
      if (
        !response.ok ||
        !payload.success ||
        !payload.user?.id ||
        !payload.user?.email
      ) {
        throw new Error(payload.error || 'Failed to save profile');
      }

      const updatedUser = normalizeUser({
        id: payload.user.id,
        email: payload.user.email,
        name: payload.user.name ?? null,
        username: payload.user.username ?? null,
        phone: payload.user.phone ?? null,
        country: payload.user.country ?? null,
      });

      onUserUpdated(updatedUser);
      setForm(toProfileForm(updatedUser));
      setSuccessMessage('Profile saved successfully.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-4xl font-black text-gray-900 mb-2">Profile</h1>
        <p className="text-gray-600">Update your account details. Empty fields are highlighted in red.</p>
      </div>

      <div
        className={`rounded-xl border p-4 flex items-start gap-3 ${
          missingFields.length === 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
        }`}
      >
        {missingFields.length === 0 ? (
          <CheckCircle2 className="text-green-600 mt-0.5" size={18} />
        ) : (
          <AlertCircle className="text-red-600 mt-0.5" size={18} />
        )}
        <div>
          <p className="font-semibold text-gray-900">
            {missingFields.length === 0 ? 'Profile complete' : 'Profile incomplete'}
          </p>
          {missingFields.length === 0 ? (
            <p className="text-sm text-gray-600">All profile fields are filled in.</p>
          ) : (
            <p className="text-sm text-gray-600">Missing: {missingFields.join(', ')}</p>
          )}
        </div>
      </div>

      <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PROFILE_FIELDS.map((field) => (
            <div key={field.key}>
              <label
                htmlFor={`profile-${field.key}`}
                className="block text-sm font-semibold text-gray-700 mb-2"
              >
                {field.label}
              </label>
              <input
                id={`profile-${field.key}`}
                type={field.type}
                autoComplete={field.autoComplete}
                value={form[field.key]}
                onChange={(event) => handleChange(field.key, event.target.value)}
                className={inputClass(form[field.key])}
              />
            </div>
          ))}
        </div>

        {errorMessage && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {errorMessage}
          </p>
        )}
        {successMessage && (
          <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            {successMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
        >
          <Save size={16} />
          {isSaving ? 'Saving...' : 'Save profile'}
        </button>
      </form>
    </div>
  );
}

export default Profile;
