import type { Response } from 'express';
import type { Request } from '../../types/http.ts';
import type { Pool } from 'pg';
import { ORG_ROLE_RANK } from '../../user-auth.ts';

export type TenantRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface AutopilotTenantContext {
  tenantId: string;
  orgId: string | null;
  projectId: string | null;
  userId: string;
  userRole: TenantRole;
  canEdit: boolean;
  canApprove: boolean;
  canPublish: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pickHeaderOrParam(req: Request, headerName: string, queryKey: string, bodyKey: string): string | null {
  const fromHeader = req.headers[headerName];
  const raw =
    (typeof fromHeader === 'string' ? fromHeader : Array.isArray(fromHeader) ? fromHeader[0] : '') ||
    (typeof req.query?.[queryKey] === 'string' ? (req.query[queryKey] as string) : '') ||
    (typeof (req.body as any)?.[bodyKey] === 'string' ? (req.body as any)[bodyKey] : '');
  const trimmed = String(raw || '').trim();
  return trimmed || null;
}

/**
 * Resolves and strictly authorizes the tenant/workspace boundary for every Autopilot request.
 * - If an organization (`X-Organization-Id` / `orgId`) or explicit `X-Tenant-Id` is supplied,
 *   verifies membership and minimum role in `organization_memberships` (and `projects` when `projectId` is given).
 * - If no org is supplied, isolates strictly to `user:<authenticatedUserId>`.
 * - Never trusts client-supplied tenant IDs without server-side ownership/membership proof.
 */
export async function resolveAutopilotTenant(
  req: Request,
  res: Response,
  requireAuth: (req: Request, res: Response) => { userId: string; role?: string } | null,
  pool: Pick<Pool, 'query'> | null,
  hasDatabase: () => boolean,
  minRole: TenantRole = 'viewer',
): Promise<AutopilotTenantContext | null> {
  const auth = requireAuth(req, res);
  if (!auth) return null;

  const orgId = pickHeaderOrParam(req, 'x-organization-id', 'orgId', 'org_id');
  const projectId = pickHeaderOrParam(req, 'x-project-id', 'projectId', 'project_id');
  const explicitWorkspaceKey = pickHeaderOrParam(req, 'x-workspace-key', 'workspaceKey', 'workspace_key');

  if (orgId) {
    if (!UUID_RE.test(orgId)) {
      res.status(400).json({ success: false, error: 'Invalid organization ID format' });
      return null;
    }
    if (!pool || !hasDatabase()) {
      res.status(503).json({ success: false, error: 'Organization authorization requires database connectivity' });
      return null;
    }

    const memRes = await pool.query(
      `SELECT role FROM organization_memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
      [orgId, auth.userId],
    );
    const memberRole = (memRes.rows[0]?.role as TenantRole | undefined) ?? null;
    if (!memberRole || (ORG_ROLE_RANK[memberRole] ?? 0) < (ORG_ROLE_RANK[minRole] ?? 0)) {
      res.status(403).json({ success: false, error: 'Forbidden: insufficient permissions for this organization workspace' });
      return null;
    }

    if (projectId) {
      if (!UUID_RE.test(projectId)) {
        res.status(400).json({ success: false, error: 'Invalid project ID format' });
        return null;
      }
      const projRes = await pool.query(
        `SELECT id FROM projects WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [projectId, orgId],
      );
      if (!projRes.rows.length) {
        res.status(403).json({ success: false, error: 'Forbidden: project does not belong to this organization' });
        return null;
      }
    }

    const tenantId = projectId ? `proj:${projectId}` : `org:${orgId}`;
    const rank = ORG_ROLE_RANK[memberRole] ?? 0;
    return {
      tenantId,
      orgId,
      projectId: projectId || null,
      userId: auth.userId,
      userRole: memberRole,
      canEdit: rank >= ORG_ROLE_RANK.editor,
      canApprove: rank >= ORG_ROLE_RANK.admin,
      canPublish: rank >= ORG_ROLE_RANK.admin,
    };
  }

  // Solo user or sub-brand workspace owned strictly by auth.userId.
  // An optional workspaceKey is always namespaced under `user:${auth.userId}:` so
  // User A can never address User B's tenant even if they guess a workspace key!
  const safeSubKey = explicitWorkspaceKey
    ? explicitWorkspaceKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
    : '';
  const tenantId = safeSubKey ? `user:${auth.userId}:${safeSubKey}` : `user:${auth.userId}`;

  // Allow test/role simulation header ONLY if narrowing own role (e.g. testing editor vs owner permissions on own workspace)
  const simulatedRoleHeader = String(req.headers['x-autopilot-role'] || '').toLowerCase();
  const effectiveRole: TenantRole =
    simulatedRoleHeader === 'viewer' || simulatedRoleHeader === 'editor' || simulatedRoleHeader === 'admin'
      ? (simulatedRoleHeader as TenantRole)
      : 'owner';

  if ((ORG_ROLE_RANK[effectiveRole] ?? 0) < (ORG_ROLE_RANK[minRole] ?? 0)) {
    res.status(403).json({ success: false, error: `Forbidden: requires at least ${minRole} role` });
    return null;
  }

  const rank = ORG_ROLE_RANK[effectiveRole] ?? 4;
  return {
    tenantId,
    orgId: null,
    projectId: null,
    userId: auth.userId,
    userRole: effectiveRole,
    canEdit: rank >= ORG_ROLE_RANK.editor,
    canApprove: rank >= ORG_ROLE_RANK.admin,
    canPublish: rank >= ORG_ROLE_RANK.admin,
  };
}
