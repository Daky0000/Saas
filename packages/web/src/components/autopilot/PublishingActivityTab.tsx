import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  Loading,
  Notice,
  RelativeTime,
  SectionHeading,
  Table,
  Td,
  Th,
  Thead,
  Tr,
} from '../ui';
import { autopilotService } from '../../services/autopilotService';
import { API_BASE_URL } from '../../utils/apiBase';

interface Props {
  onRefreshOverview: () => void;
}

export default function PublishingActivityTab({ onRefreshOverview }: Props) {
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [publications, setPublications] = useState<any[]>([]);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [legacyLogs, setLegacyLogs] = useState<any[]>([]);
  const [attemptsDrawer, setAttemptsDrawer] = useState<{ pub: any; attempts: any[] } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pubRes, auditRes, legRes] = await Promise.all([
        autopilotService.listPublications(),
        autopilotService.listAuditEvents().catch(() => ({ events: [] })),
        fetch(`${API_BASE_URL}/api/automation/logs`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
        })
          .then((r) => r.json())
          .catch(() => ({ logs: [] })),
      ]);
      setPublications(pubRes.publications || []);
      setAuditEvents(auditRes.events || []);
      setLegacyLogs(legRes.logs || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load publishing activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handlePublish = async (pubId: string, isRetry: boolean) => {
    setBusyId(pubId);
    setError(null);
    setNote(null);
    try {
      const res = isRetry
        ? await autopilotService.retryPublication(pubId)
        : await autopilotService.publishNow(pubId);
      if (res.deduplicated) {
        setNote(`Idempotency guard prevented duplicate post — existing remote_post_id "${res.publication.remote_post_id}" preserved.`);
      } else if (res.publication.status === 'published') {
        setNote(`Published to ${res.publication.channel} (${res.publication.platform_media_type}) · ID ${res.publication.remote_post_id}.`);
      } else {
        setError(res.publication.error_message || 'Publish failed');
      }
      await loadAll();
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Publish execution failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleInspectAttempts = async (pubId: string) => {
    try {
      const res = await autopilotService.getPublicationAttempts(pubId);
      setAttemptsDrawer({ pub: res.publication, attempts: res.attempts || [] });
    } catch (e: any) {
      setError(e.message || 'Failed to load attempt ledger');
    }
  };

  if (loading) {
    return <Loading label="Loading publishing & idempotency ledger" rows={4} />;
  }

  return (
    <div className="space-y-6">
      {error && <Notice tone="danger" title="Publishing Alert">{error}</Notice>}
      {note && <Notice tone="positive" title="Publishing Update">{note}</Notice>}

      <Card>
        <SectionHeading
          title="Multi-Channel Publications & Idempotent Delivery"
          hint="Each channel schedule executes with deterministic idempotency keys, transient vs permanent error classification, and zero duplicate live posts on retry."
          action={
            <Button variant="secondary" size="sm" onClick={() => void loadAll()}>
              Refresh Ledger
            </Button>
          }
        />

        {publications.length === 0 ? (
          <EmptyState message="No scheduled or completed channel publications yet. Approve an item in the Approval Queue and assign a slot." />
        ) : (
          <Table>
            <Thead>
              <Th>Channel & Format</Th>
              <Th>Named Slot & Timezone</Th>
              <Th>Status</Th>
              <Th>Remote Post / Remediation</Th>
              <Th align="right">Actions</Th>
            </Thead>
            <tbody>
              {publications.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <div className="font-medium capitalize text-ink">{p.channel}</div>
                    <div className="font-mono text-[11px] text-muted">{p.platform_media_type}</div>
                  </Td>
                  <Td>
                    <div className="text-xs text-ink">{p.slot_name || 'Scheduled'}</div>
                    <div className="font-mono text-[11px] text-muted">
                      {p.scheduled_at ? new Date(p.scheduled_at).toLocaleString() : '—'} ({p.timezone})
                    </div>
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        p.status === 'published'
                          ? 'positive'
                          : p.status === 'publish_failed'
                            ? 'danger'
                            : p.status === 'scheduled'
                              ? 'info'
                              : 'muted'
                      }
                    >
                      {p.status}
                    </Badge>
                  </Td>
                  <Td>
                    {p.remote_post_id ? (
                      <span className="font-mono text-xs text-ink">{p.remote_post_id}</span>
                    ) : p.error_message ? (
                      <span className="text-xs text-danger-text">{p.error_message}</span>
                    ) : (
                      <span className="text-xs text-muted">Awaiting execution</span>
                    )}
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => void handleInspectAttempts(p.id)}>
                        Attempts
                      </Button>
                      {p.status === 'scheduled' && (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={busyId === p.id}
                          onClick={() => void handlePublish(p.id, false)}
                        >
                          Publish Now
                        </Button>
                      )}
                      {p.status === 'publish_failed' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busyId === p.id}
                          onClick={() => void handlePublish(p.id, true)}
                        >
                          Idempotent Retry
                        </Button>
                      )}
                      {(p.status === 'scheduled' || p.status === 'pending') && (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busyId === p.id}
                          onClick={async () => {
                            await autopilotService.cancelPublication(p.id);
                            await loadAll();
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Audit Trail */}
      <Card>
        <SectionHeading
          title="Workspace Audit Trail"
          hint="Server-recorded history of brand scans, strategy approvals, cost-cap blocks, human sign-offs, and publishing events."
        />
        {auditEvents.length === 0 ? (
          <EmptyState message="Audit events will appear here as actions run in this workspace." />
        ) : (
          <Table>
            <Thead>
              <Th>Event</Th>
              <Th>Resource</Th>
              <Th>Role</Th>
              <Th>When</Th>
            </Thead>
            <tbody>
              {auditEvents.slice(0, 20).map((ev) => (
                <Tr key={ev.id}>
                  <Td><span className="font-mono text-xs text-ink">{ev.event_type}</span></Td>
                  <Td><span className="font-mono text-xs text-muted">{ev.resource_type}:{String(ev.resource_id).slice(0, 8)}</span></Td>
                  <Td><Badge tone="muted">{ev.actor_role || 'user'}</Badge></Td>
                  <Td><RelativeTime value={ev.created_at} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Legacy Blog/Social Distribution Logs (preserved for continuity) */}
      {legacyLogs.length > 0 && (
        <Card>
          <SectionHeading title="Legacy Blog Distribution Logs" hint="Historical social distribution runs from Blog Posts." />
          <Table>
            <Thead>
              <Th>Post</Th>
              <Th>Platform</Th>
              <Th>Status</Th>
              <Th>Time</Th>
            </Thead>
            <tbody>
              {legacyLogs.slice(0, 15).map((log: any) => (
                <Tr key={log.id}>
                  <Td>{log.post_title || log.post_id?.slice(0, 8)}</Td>
                  <Td className="capitalize">{log.platform}</Td>
                  <Td><Badge tone={log.status === 'published' ? 'positive' : log.status === 'failed' ? 'danger' : 'muted'}>{log.status}</Badge></Td>
                  <Td><RelativeTime value={log.created_at} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Idempotent Attempts Drawer */}
      <Drawer
        open={Boolean(attemptsDrawer)}
        onClose={() => setAttemptsDrawer(null)}
        title="Idempotent Publication Attempts"
        subtitle={attemptsDrawer ? `${attemptsDrawer.pub.channel} · ${attemptsDrawer.pub.platform_media_type}` : ''}
      >
        {attemptsDrawer && (
          <div className="space-y-3">
            {attemptsDrawer.attempts.length === 0 ? (
              <p className="text-xs text-muted">No attempts executed yet.</p>
            ) : (
              attemptsDrawer.attempts.map((a) => (
                <div key={a.id} className="rounded-xl border border-line bg-sunken p-4 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium text-ink">Attempt #{a.attempt_number}</span>
                    <Badge tone={a.status === 'succeeded' ? 'positive' : a.retryable ? 'warn' : 'danger'}>
                      {a.status}
                    </Badge>
                  </div>
                  <div className="mt-1.5 font-mono text-[11px] text-muted">
                    Idempotency-Key: {a.idempotency_key}
                  </div>
                  {a.error_message && <div className="mt-1 text-danger-text">{a.error_message}</div>}
                  {a.next_retry_at && (
                    <div className="mt-1 font-mono text-[11px] text-muted">
                      Next exponential backoff window: {new Date(a.next_retry_at).toLocaleString()}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
