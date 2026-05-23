import express from 'express';
import type { Router, Request, Response } from 'express';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; role?: string } | null;

interface HubtelDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
}

export function registerHubtelRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, getPlatformConfig }: HubtelDeps): Router {
  const router = express.Router();

  async function getHubtelConfig(): Promise<{ clientId: string; clientSecret: string; merchantAccountNumber: string } | null> {
    const cfg = await getPlatformConfig('hubtel');
    const clientId = cfg.clientId || process.env.HUBTEL_CLIENT_ID || '';
    const clientSecret = cfg.clientSecret || process.env.HUBTEL_CLIENT_SECRET || '';
    const merchantAccountNumber = cfg.merchantAccountNumber || process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER || '';
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret, merchantAccountNumber };
  }

  // POST /api/payments/hubtel/initiate
  router.post('/payments/hubtel/initiate', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { amount, description, customerName, customerEmail, customerMsisdn } = req.body as {
        amount: number; description: string; customerName: string; customerEmail: string; customerMsisdn: string;
      };

      if (!amount || !customerName || !customerMsisdn) {
        return res.status(400).json({ success: false, error: 'amount, customerName, and customerMsisdn are required' });
      }

      const hubtel = await getHubtelConfig();
      if (!hubtel) {
        return res.status(503).json({ success: false, error: 'Hubtel is not configured. Add credentials in Admin > Payments.' });
      }

      const clientReference = randomUUID();
      const backendUrl = process.env.BACKEND_PUBLIC_URL || `https://contentflow-api.onrender.com`;

      const payload = {
        totalAmount: Number(amount),
        description: description || 'Payment',
        callbackUrl: `${backendUrl}/api/payments/hubtel/callback`,
        returnUrl: `${process.env.FRONTEND_ORIGIN || 'https://marketing.dakyworld.com'}/payments/success`,
        cancellationUrl: `${process.env.FRONTEND_ORIGIN || 'https://marketing.dakyworld.com'}/payments/cancel`,
        merchantAccountNumber: hubtel.merchantAccountNumber,
        clientReference,
      };

      const response = await axios.post('https://payproxyapi.hubtel.com/items/initiate', payload, {
        auth: { username: hubtel.clientId, password: hubtel.clientSecret },
        headers: { 'Content-Type': 'application/json' },
      });

      const checkoutUrl: string = response.data?.data?.checkoutUrl || response.data?.checkoutUrl || '';
      const txnId = randomUUID();

      if (hasDatabase()) {
        await dbQuery(
          `INSERT INTO payment_transactions
             (id, amount, currency, description, status, provider, client_reference, customer_name, customer_email, customer_phone, checkout_url, metadata)
           VALUES ($1,$2,'GHS',$3,'pending','hubtel',$4,$5,$6,$7,$8,$9)`,
          [txnId, Number(amount), description || null, clientReference, customerName, customerEmail || null, customerMsisdn, checkoutUrl, JSON.stringify(response.data || null)]
        );
      } else {
        logger.warn('Payment transaction could not be persisted — no database available');
      }

      return res.json({ success: true, checkoutUrl, clientReference });
    } catch (error: any) {
      logger.error('Hubtel initiate error:', error?.response?.data || error);
      return res.status(502).json({ success: false, error: error?.response?.data?.message || 'Failed to initiate payment' });
    }
  });

  // POST /api/payments/hubtel/callback
  router.post('/payments/hubtel/callback', async (req: Request, res: Response) => {
    try {
      const body = req.body as any;
      const clientReference: string = body?.Data?.ClientReference || body?.clientReference || '';
      const status: string = (body?.Data?.Status || body?.status || 'failed').toLowerCase();
      const providerRef: string = body?.Data?.TransactionId || body?.transactionId || '';
      const mappedStatus = status === 'successful' || status === 'success' ? 'successful' : status === 'pending' ? 'pending' : 'failed';

      if (clientReference && hasDatabase()) {
        await dbQuery(
          `UPDATE payment_transactions SET status = $1, provider_reference = $2, updated_at = NOW(), metadata = metadata || $3::jsonb
           WHERE client_reference = $4`,
          [mappedStatus, providerRef, JSON.stringify({ hubtelCallback: body }), clientReference]
        );
      } else if (clientReference) {
        logger.warn('Hubtel callback: no database available to update transaction', { clientReference });
      }

      return res.json({ success: true });
    } catch (error) {
      logger.error('Hubtel callback error:', error);
      return res.status(500).json({ success: false, error: 'Callback processing failed' });
    }
  });

  // GET /api/payments/hubtel/verify/:clientReference
  router.get('/payments/hubtel/verify/:clientReference', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { clientReference } = req.params;
      const hubtel = await getHubtelConfig();

      if (hubtel) {
        try {
          const response = await axios.get(
            `https://api.hubtel.com/checkout/v1.1/merchant/transactions/status?clientReference=${clientReference}`,
            { auth: { username: hubtel.clientId, password: hubtel.clientSecret } }
          );
          const remoteStatus = (response.data?.data?.status || '').toLowerCase();
          const mappedStatus = remoteStatus === 'successful' || remoteStatus === 'success' ? 'successful' : remoteStatus === 'pending' ? 'pending' : 'failed';

          if (hasDatabase()) {
            await dbQuery(`UPDATE payment_transactions SET status = $1, updated_at = NOW() WHERE client_reference = $2`, [mappedStatus, clientReference]);
          }
          return res.json({ success: true, status: mappedStatus, data: response.data });
        } catch (_err) {
          // fall through to DB lookup
        }
      }

      if (hasDatabase()) {
        const result = await dbQuery('SELECT status FROM payment_transactions WHERE client_reference = $1', [clientReference]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Transaction not found' });
        return res.json({ success: true, status: result.rows[0].status });
      }

      return res.status(503).json({ success: false, error: 'Database unavailable' });
    } catch (error) {
      logger.error('Verify payment error:', error);
      return res.status(500).json({ success: false, error: 'Failed to verify payment' });
    }
  });

  // GET /api/admin/payments
  router.get('/admin/payments', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });

      const result = await dbQuery(
        `SELECT id, amount, currency, description, status, provider, client_reference, provider_reference,
                customer_name, customer_email, customer_phone, created_at, updated_at
         FROM payment_transactions ORDER BY created_at DESC LIMIT 200`
      );
      return res.json({ success: true, transactions: result.rows });
    } catch (error) {
      logger.error('List payments error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch transactions' });
    }
  });

  // GET /api/admin/payments/stats
  router.get('/admin/payments/stats', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });

      const result = await dbQuery(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'successful')::int AS successful,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COALESCE(SUM(amount) FILTER (WHERE status = 'successful'), 0)::numeric AS revenue
        FROM payment_transactions
      `);
      return res.json({ success: true, stats: result.rows[0] });
    } catch (error) {
      logger.error('Payment stats error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch payment stats' });
    }
  });

  return router;
}
