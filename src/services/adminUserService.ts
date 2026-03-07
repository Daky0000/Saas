import {
  BulkUserAction,
  CreateUserInput,
  ManagedUser,
  ManagedUserStatus,
  PaginatedUsersResponse,
  UpdateUserInput,
  UserQueryParams,
} from '../types/admin';

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com')
  ? ''
  : rawApiBaseUrl.replace(/\/$/, '');

const authHeaders = () => {
  if (typeof window === 'undefined') return {} as Record<string, string>;
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const parseJson = async <T>(response: Response): Promise<T | null> => {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const extractError = async (response: Response, fallback: string) => {
  const payload = await parseJson<{ error?: string; message?: string }>(response);
  return payload?.error || payload?.message || fallback;
};

export const adminUserService = {
  async getUsers(query: UserQueryParams): Promise<PaginatedUsersResponse> {
    const params = new URLSearchParams({
      search: query.search,
      role: query.role,
      status: query.status,
      joined: query.joined,
      page: String(query.page),
      perPage: String(query.perPage),
    });

    const response = await fetch(`${API_BASE_URL}/api/users?${params.toString()}`, {
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to fetch users'));
    }

    const payload = await parseJson<PaginatedUsersResponse>(response);
    if (!payload) {
      throw new Error('Invalid users response');
    }

    return payload;
  },

  async createUser(input: CreateUserInput): Promise<ManagedUser> {
    const response = await fetch(`${API_BASE_URL}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to create user'));
    }

    const payload = await parseJson<ManagedUser>(response);
    if (!payload) {
      throw new Error('Invalid create-user response');
    }

    return payload;
  },

  async updateUser(id: string, input: UpdateUserInput): Promise<ManagedUser> {
    const response = await fetch(`${API_BASE_URL}/api/users/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to update user'));
    }

    const payload = await parseJson<ManagedUser>(response);
    if (!payload) {
      throw new Error('Invalid update-user response');
    }

    return payload;
  },

  async deleteUser(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/users/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to delete user'));
    }
  },

  async patchUserStatus(id: string, status: ManagedUserStatus): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/users/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to update user status'));
    }
  },

  async patchUserRole(id: string, role: ManagedUser['role']): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/users/${id}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ role }),
    });

    if (!response.ok) {
      throw new Error(await extractError(response, 'Failed to update user role'));
    }
  },

  async bulkAction(action: BulkUserAction): Promise<void> {
    if (action.type === 'delete') {
      await Promise.all(action.userIds.map((userId) => this.deleteUser(userId)));
      return;
    }

    if (action.type === 'changeRole' && action.role) {
      await Promise.all(action.userIds.map((userId) => this.patchUserRole(userId, action.role!)));
      return;
    }

    const nextStatus: Record<'activate' | 'suspend', ManagedUserStatus> = {
      activate: 'Active',
      suspend: 'Suspended',
    };

    await Promise.all(
      action.userIds.map((userId) =>
        this.patchUserStatus(userId, nextStatus[action.type as 'activate' | 'suspend']),
      ),
    );
  },
};
