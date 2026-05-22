import { randomUUID } from 'crypto';
import express from 'express';
import type { Express, Router, Request, Response } from 'express';
import type { Pool } from 'pg';
import { registerBlogAnalyticsRoutes } from './blogAnalyticsRoutes.ts';

type AuthResult = { userId: string; email?: string } | null;
type RequireAuthFn = (req: Request, res: Response) => AuthResult;

type BlogRouteDeps = {
  /**
   * The global Express app — used only to register /api/v1/calendar and
   * /api/v1/posts GET routes that live outside the /api/v1/blog/ namespace.
   */
  app: Express;
  pool: Pool | null;
  requireAuth: RequireAuthFn;
  hasDatabase: () => boolean;
  slugify: (text: string) => string;
  clearCalendarCacheForUser: (userId: string) => void;
  getCalendarCache: (key: string) => any;
  setCalendarCache: (key: string, value: any) => void;
  syncBlogPostMedia: (
    userId: string,
    post: { id: string; title?: string | null; featured_image?: string | null; social_image?: string | null; content?: string | null },
  ) => Promise<number>;
  checkTaskActions: (userId: string, action: string) => Promise<void>;
  fireWorkflowTriggers: (userId: string, event: string, data: any) => Promise<void>;
  queueSocialAutomationForPublishedPost: (userId: string, post: Record<string, any>) => Promise<void>;
  recordAuditLog: (userId: string, action: string, postIds: string[], changes: Record<string, any>) => Promise<void>;
  getVisibleUserPlatformSlugs: () => Promise<string[]>;
  syncSocialAutomationForPost: (userId: string, postId: string) => Promise<void>;
};

/**
 * Registers all /api/v1/blog/* routes and returns the Express Router.
 * The caller mounts the returned router at the desired path(s):
 *   app.use('/api/v1/blog', blogRouter);          // canonical
 *   app.use('/api/blog', deprecate(), blogRouter); // backward-compat shim
 *
 * Also registers /api/v1/calendar and /api/v1/posts GET directly on `app`
 * because those endpoints predate the /blog/ namespace.
 */
export function registerBlogRoutes({
  app,
  pool,
  requireAuth,
  hasDatabase,
  slugify,
  clearCalendarCacheForUser,
  getCalendarCache,
  setCalendarCache,
  syncBlogPostMedia,
  checkTaskActions,
  fireWorkflowTriggers,
  queueSocialAutomationForPublishedPost,
  recordAuditLog,
  getVisibleUserPlatformSlugs,
  syncSocialAutomationForPost,
}: BlogRouteDeps): Router {
  const router = express.Router();

  // Analytics sub-router (mounted at /analytics relative to this router)
  const analyticsRouter = express.Router();
  registerBlogAnalyticsRoutes({ router: analyticsRouter, getPool: () => pool, requireAuth });
  router.use('/analytics', analyticsRouter);

  // Guard: all routes in this router require a live DB
  router.use((_req: Request, res: Response, next) => {
    if (!hasDatabase()) {
      return res.status(503).json({ success: false, error: 'Database not configured' });
    }
    return next();
  });

  // GET /categories
  router.get('/categories', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { rows } = await pool!.query(
      'SELECT * FROM blog_categories WHERE user_id=$1 ORDER BY name',
      [user.userId],
    );
    return res.json({ success: true, categories: rows });
  });

  // POST /categories
  router.post('/categories', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { name } = req.body as { name: string };
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });
    const id = randomUUID();
    const slug = slugify(name);
    const { rows } = await pool!.query(
      'INSERT INTO blog_categories (id, user_id, name, slug) VALUES ($1,$2,$3,$4) RETURNING *',
      [id, user.userId, name.trim(), slug],
    );
    return res.json({ success: true, category: rows[0] });
  });

  // PUT /categories/:id
  router.put('/categories/:id', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { id } = req.params;
    const { name } = req.body as { name: string };
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });
    const slug = slugify(name);
    const { rows } = await pool!.query(
      'UPDATE blog_categories SET name=$1, slug=$2 WHERE id=$3 AND user_id=$4 RETURNING *',
      [name.trim(), slug, id, user.userId],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, category: rows[0] });
  });

  // DELETE /categories/:id
  router.delete('/categories/:id', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { id } = req.params;
    await pool!.query('DELETE FROM blog_categories WHERE id=$1 AND user_id=$2', [id, user.userId]);
    return res.json({ success: true });
  });

  // GET /tags
  router.get('/tags', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { rows } = await pool!.query(
      'SELECT * FROM blog_tags WHERE user_id=$1 ORDER BY name',
      [user.userId],
    );
    return res.json({ success: true, tags: rows });
  });

  // POST /tags
  router.post('/tags', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { name } = req.body as { name: string };
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });
    const id = randomUUID();
    const slug = slugify(name);
    const { rows } = await pool!.query(
      'INSERT INTO blog_tags (id, user_id, name, slug) VALUES ($1,$2,$3,$4) RETURNING *',
      [id, user.userId, name.trim(), slug],
    );
    return res.json({ success: true, tag: rows[0] });
  });

  // DELETE /tags/:id
  router.delete('/tags/:id', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { id } = req.params;
    await pool!.query('DELETE FROM blog_tags WHERE id=$1 AND user_id=$2', [id, user.userId]);
    return res.json({ success: true });
  });

  // GET /posts
  router.get('/posts', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { status, search } = req.query as { status?: string; search?: string };
    let q = `SELECT p.*, c.name AS category_name,
      ARRAY(SELECT t.id FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_ids,
      ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
      FROM blog_posts p LEFT JOIN blog_categories c ON c.id=p.category_id
      WHERE p.user_id=$1`;
    const params: (string | number)[] = [user.userId];
    if (status && status !== 'all') {
      params.push(status);
      q += ` AND p.status=$${params.length}`;
    } else {
      q += ` AND p.status NOT IN ('archived','deleted')`;
    }
    if (search) { params.push(`%${search}%`); q += ` AND p.title ILIKE $${params.length}`; }
    q += ' ORDER BY p.updated_at DESC';
    const { rows } = await pool!.query(q, params);
    return res.json({ success: true, posts: rows });
  });

  // GET /posts/:id — must come AFTER batch routes to avoid /:id swallowing batch paths
  router.get('/posts/:id', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { id } = req.params;
    const { rows } = await pool!.query(
      `SELECT p.*, c.name AS category_name,
        ARRAY(SELECT t.id FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_ids,
        ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
       FROM blog_posts p LEFT JOIN blog_categories c ON c.id=p.category_id
       WHERE p.id=$1 AND p.user_id=$2`,
      [id, user.userId],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, post: rows[0] });
  });

  // POST /posts
  router.post('/posts', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const {
      title = '', slug: rawSlug, content = '', excerpt = '', featured_image = '',
      status = 'draft', category_id, meta_title = '', meta_description = '', focus_keyword = '',
      social_title = '', social_description = '', social_image = '', social_automation = {},
      scheduled_at, tag_ids = [],
    } = req.body as {
      title?: string; slug?: string; content?: string; excerpt?: string; featured_image?: string;
      status?: string; category_id?: string; meta_title?: string; meta_description?: string;
      focus_keyword?: string; social_title?: string; social_description?: string; social_image?: string;
      social_automation?: any; scheduled_at?: string; tag_ids?: string[];
    };
    const id = randomUUID();
    const slug = rawSlug?.trim() || slugify(title) || id;
    const published_at = status === 'published' ? new Date().toISOString() : null;
    const { rows } = await pool!.query(
      `INSERT INTO blog_posts (id,user_id,title,slug,content,excerpt,featured_image,status,category_id,
        meta_title,meta_description,focus_keyword,social_title,social_description,social_image,social_automation,scheduled_at,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [id, user.userId, title, slug, content, excerpt, featured_image, status,
       category_id || null, meta_title, meta_description, focus_keyword,
       social_title, social_description, social_image, JSON.stringify(social_automation || {}),
       scheduled_at || null, published_at],
    );
    if (tag_ids.length) {
      await Promise.all(
        tag_ids.map((tid: string) =>
          pool!.query('INSERT INTO blog_post_tags (post_id,tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, tid]),
        ),
      );
    }

    await syncBlogPostMedia(user.userId, rows[0]).catch((error) => {
      console.error('Blog post media sync error:', error);
    });

    void checkTaskActions(user.userId, 'create_post');
    if (status === 'scheduled') void checkTaskActions(user.userId, 'schedule_post');
    if (status === 'published') void checkTaskActions(user.userId, 'publish_post');

    void fireWorkflowTriggers(user.userId, 'post_created', rows[0]);

    if (status === 'published') {
      try {
        await queueSocialAutomationForPublishedPost(user.userId, rows[0]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Social Automation queue failed';
        console.error('Social Automation queue error:', err);
        await pool!.query(
          'INSERT INTO publishing_logs (id,post_id,user_id,platform,status,error_message) VALUES ($1,$2,$3,$4,$5,$6)',
          [randomUUID(), id, user.userId, 'facebook', 'failed', msg],
        ).catch(() => undefined);
      }
      void fireWorkflowTriggers(user.userId, 'post_published', rows[0]);
    }
    clearCalendarCacheForUser(user.userId);
    return res.json({ success: true, post: rows[0] });
  });

  // PUT /posts/:id
  router.put('/posts/:id', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { id } = req.params;
    const {
      title, slug: rawSlug, content, excerpt, featured_image, status,
      category_id, meta_title, meta_description, focus_keyword,
      social_title, social_description, social_image, social_automation, scheduled_at, tag_ids,
    } = req.body as {
      title?: string; slug?: string; content?: string; excerpt?: string; featured_image?: string;
      status?: string; category_id?: string; meta_title?: string; meta_description?: string;
      focus_keyword?: string; social_title?: string; social_description?: string; social_image?: string;
      social_automation?: any; scheduled_at?: string; tag_ids?: string[];
    };
    const existing = await pool!.query('SELECT * FROM blog_posts WHERE id=$1 AND user_id=$2', [id, user.userId]);
    if (!existing.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    const cur = existing.rows[0];
    const newTitle = title ?? cur.title;
    const newSlug = rawSlug?.trim() || (title ? slugify(title) : cur.slug);
    const newStatus = status ?? cur.status;
    const willPublish = newStatus === 'published' && String(cur.status || '') !== 'published';
    const published_at = newStatus === 'published' && !cur.published_at ? new Date().toISOString() : cur.published_at;
    const { rows } = await pool!.query(
      `UPDATE blog_posts SET title=$1,slug=$2,content=$3,excerpt=$4,featured_image=$5,status=$6,
        category_id=$7,meta_title=$8,meta_description=$9,focus_keyword=$10,social_title=$11,
        social_description=$12,social_image=$13,social_automation=$14,scheduled_at=$15,published_at=$16,updated_at=NOW()
       WHERE id=$17 AND user_id=$18 RETURNING *`,
      [newTitle, newSlug, content ?? cur.content, excerpt ?? cur.excerpt, featured_image ?? cur.featured_image,
       newStatus, category_id !== undefined ? (category_id || null) : cur.category_id,
       meta_title ?? cur.meta_title, meta_description ?? cur.meta_description,
       focus_keyword ?? cur.focus_keyword, social_title ?? cur.social_title,
       social_description ?? cur.social_description, social_image ?? cur.social_image,
       social_automation !== undefined ? JSON.stringify(social_automation || {}) : JSON.stringify(cur.social_automation || {}),
       scheduled_at !== undefined ? (scheduled_at || null) : cur.scheduled_at,
       published_at, id, user.userId],
    );
    if (tag_ids !== undefined) {
      await pool!.query('DELETE FROM blog_post_tags WHERE post_id=$1', [id]);
      if (tag_ids.length) {
        await Promise.all(
          tag_ids.map((tid: string) =>
            pool!.query('INSERT INTO blog_post_tags (post_id,tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, tid]),
          ),
        );
      }
    }

    await syncBlogPostMedia(user.userId, rows[0]).catch((error) => {
      console.error('Blog post media sync error:', error);
    });

    if (willPublish) {
      try {
        await queueSocialAutomationForPublishedPost(user.userId, rows[0]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Social Automation queue failed';
        console.error('Social Automation queue error:', err);
        await pool!.query(
          'INSERT INTO publishing_logs (id,post_id,user_id,platform,status,error_message) VALUES ($1,$2,$3,$4,$5,$6)',
          [randomUUID(), id, user.userId, 'facebook', 'failed', msg],
        ).catch(() => undefined);
      }
      void fireWorkflowTriggers(user.userId, 'post_published', rows[0]);
    }
    clearCalendarCacheForUser(user.userId);
    return res.json({ success: true, post: rows[0] });
  });

  // DELETE /posts/:id
  router.delete('/posts/:id', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { id } = req.params;
    await pool!.query('DELETE FROM blog_posts WHERE id=$1 AND user_id=$2', [id, user.userId]);
    clearCalendarCacheForUser(user.userId);
    return res.json({ success: true });
  });

  // PATCH /posts/batch/reschedule
  router.patch('/posts/batch/reschedule', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { postIds = [], scheduled_at } = req.body as { postIds?: string[]; scheduled_at?: string };
    const ids = Array.isArray(postIds) ? postIds.map((id) => String(id)).filter(Boolean) : [];
    if (!ids.length || !scheduled_at) return res.status(400).json({ success: false, error: 'Invalid payload' });

    const scheduledAt = new Date(String(scheduled_at));
    if (Number.isNaN(scheduledAt.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid scheduled_at' });
    }

    const owned = await pool!.query('SELECT id FROM blog_posts WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
    if (owned.rows.length !== ids.length) return res.status(403).json({ success: false, error: 'Not authorized' });

    const result = await pool!.query(
      `UPDATE blog_posts SET scheduled_at=$1, status='scheduled', updated_at=NOW() WHERE id = ANY($2) AND user_id=$3`,
      [scheduledAt.toISOString(), ids, user.userId],
    );

    clearCalendarCacheForUser(user.userId);
    await recordAuditLog(user.userId, 'batch_reschedule', ids, { scheduled_at: scheduledAt.toISOString() });
    return res.json({ success: true, updated: result.rowCount });
  });

  // PATCH /posts/batch/tag
  router.patch('/posts/batch/tag', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { postIds = [], tagIds = [] } = req.body as { postIds?: string[]; tagIds?: string[] };
    const ids = Array.isArray(postIds) ? postIds.map((id) => String(id)).filter(Boolean) : [];
    const tags = Array.isArray(tagIds) ? tagIds.map((id) => String(id)).filter(Boolean) : [];
    if (!ids.length || !tags.length) return res.status(400).json({ success: false, error: 'Invalid payload' });

    const owned = await pool!.query('SELECT id FROM blog_posts WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
    if (owned.rows.length !== ids.length) return res.status(403).json({ success: false, error: 'Not authorized' });

    const tagRows = await pool!.query('SELECT id FROM blog_tags WHERE id = ANY($1) AND user_id=$2', [tags, user.userId]);
    if (tagRows.rows.length !== tags.length) {
      return res.status(403).json({ success: false, error: 'Some tags are not available for this user' });
    }

    await pool!.query(
      `INSERT INTO blog_post_tags (post_id, tag_id)
       SELECT p, t FROM UNNEST($1::text[]) AS p CROSS JOIN UNNEST($2::text[]) AS t
       ON CONFLICT DO NOTHING`,
      [ids, tags],
    );

    const result = await pool!.query(
      'UPDATE blog_posts SET updated_at=NOW() WHERE id = ANY($1) AND user_id=$2',
      [ids, user.userId],
    );
    await recordAuditLog(user.userId, 'batch_tag', ids, { tag_ids: tags });
    return res.json({ success: true, updated: result.rowCount });
  });

  // PATCH /posts/batch/archive
  router.patch('/posts/batch/archive', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { postIds = [] } = req.body as { postIds?: string[] };
    const ids = Array.isArray(postIds) ? postIds.map((id) => String(id)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'Invalid postIds' });

    const owned = await pool!.query('SELECT id FROM blog_posts WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
    if (owned.rows.length !== ids.length) return res.status(403).json({ success: false, error: 'Not authorized' });

    const result = await pool!.query(
      `UPDATE blog_posts SET status='archived', updated_at=NOW() WHERE id = ANY($1) AND user_id=$2`,
      [ids, user.userId],
    );
    clearCalendarCacheForUser(user.userId);
    await recordAuditLog(user.userId, 'batch_archive', ids, {});
    return res.json({ success: true, updated: result.rowCount });
  });

  // PATCH /posts/batch/delete
  router.patch('/posts/batch/delete', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { postIds = [] } = req.body as { postIds?: string[] };
    const ids = Array.isArray(postIds) ? postIds.map((id) => String(id)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'Invalid postIds' });

    const owned = await pool!.query('SELECT id FROM blog_posts WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
    if (owned.rows.length !== ids.length) return res.status(403).json({ success: false, error: 'Not authorized' });

    const result = await pool!.query(
      `UPDATE blog_posts SET status='deleted', updated_at=NOW() WHERE id = ANY($1) AND user_id=$2`,
      [ids, user.userId],
    );
    clearCalendarCacheForUser(user.userId);
    await recordAuditLog(user.userId, 'batch_delete', ids, {});
    return res.json({ success: true, updated: result.rowCount });
  });

  // POST /posts/batch/duplicate
  router.post('/posts/batch/duplicate', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { postIds = [] } = req.body as { postIds?: string[] };
    const ids = Array.isArray(postIds) ? postIds.map((id) => String(id)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'Invalid postIds' });

    const { rows } = await pool!.query(
      'SELECT * FROM blog_posts WHERE id = ANY($1) AND user_id=$2',
      [ids, user.userId],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'No posts found' });

    let created = 0;
    for (const src of rows) {
      const newId = randomUUID();
      const { rows: newRows } = await pool!.query(
        `INSERT INTO blog_posts (id,user_id,title,slug,content,excerpt,featured_image,status,category_id,
          meta_title,meta_description,focus_keyword,social_title,social_description,social_image)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [newId, user.userId, `${src.title} (Copy)`, `${src.slug}-copy`, src.content, src.excerpt,
         src.featured_image, src.category_id, src.meta_title, src.meta_description, src.focus_keyword,
         src.social_title, src.social_description, src.social_image],
      );
      const tagRows = await pool!.query('SELECT tag_id FROM blog_post_tags WHERE post_id=$1', [src.id]);
      if (tagRows.rows.length) {
        await Promise.all(
          tagRows.rows.map((r: { tag_id: string }) =>
            pool!.query('INSERT INTO blog_post_tags (post_id,tag_id) VALUES ($1,$2)', [newId, r.tag_id]),
          ),
        );
      }
      if (newRows.length) created += 1;
    }

    clearCalendarCacheForUser(user.userId);
    await recordAuditLog(user.userId, 'batch_duplicate', ids, { created });
    return res.json({ success: true, created });
  });

  // PATCH /posts/batch/platforms
  router.patch('/posts/batch/platforms', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { postIds = [], accountIds = [] } = req.body as { postIds?: string[]; accountIds?: string[] };
    const ids = Array.isArray(postIds) ? postIds.map((id) => String(id)).filter(Boolean) : [];
    const accounts = Array.isArray(accountIds) ? accountIds.map((id) => String(id)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'Invalid postIds' });

    const owned = await pool!.query('SELECT id FROM blog_posts WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
    if (owned.rows.length !== ids.length) return res.status(403).json({ success: false, error: 'Not authorized' });

    const visiblePlatforms = await getVisibleUserPlatformSlugs();

    if (accounts.length > 0) {
      const accountRows = await pool!.query(
        `SELECT id, platform FROM social_accounts WHERE id = ANY($1) AND user_id = $2`,
        [accounts, user.userId],
      );
      const validAccounts =
        visiblePlatforms.length > 0
          ? accountRows.rows.filter((acc: any) => visiblePlatforms.includes(String(acc.platform || '').toLowerCase()))
          : accountRows.rows;
      if (validAccounts.length !== accounts.length) {
        return res.status(400).json({ success: false, error: 'Some selected accounts are from integrations that are not available in this workspace' });
      }
    }

    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const settingsRows = await client.query(
        'SELECT id, post_id FROM social_post_settings WHERE post_id = ANY($1)',
        [ids],
      );
      const map = new Map<string, string>();
      settingsRows.rows.forEach((row: any) => map.set(String(row.post_id), String(row.id)));

      for (const postId of ids) {
        let settingId = map.get(postId);
        if (!settingId) {
          settingId = randomUUID();
          await client.query(
            `INSERT INTO social_post_settings (id, post_id, template, publish_type, scheduled_at)
             VALUES ($1,$2,'','immediate',NULL)`,
            [settingId, postId],
          );
        }

        await client.query('DELETE FROM social_post_targets WHERE social_post_id=$1', [settingId]);
        for (const accountId of accounts) {
          await client.query(
            `INSERT INTO social_post_targets (id, social_post_id, social_account_id, enabled)
             VALUES ($1,$2,$3,true)`,
            [randomUUID(), settingId, accountId],
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('batch platform update error:', err);
      return res.status(500).json({ success: false, error: 'Failed to update platforms' });
    } finally {
      client.release();
    }

    const publishedRows = await pool!.query(
      `SELECT id FROM blog_posts WHERE id = ANY($1) AND user_id=$2 AND status='published'`,
      [ids, user.userId],
    );

    for (const row of publishedRows.rows as Array<{ id: string }>) {
      await syncSocialAutomationForPost(user.userId, String(row.id));
    }

    await recordAuditLog(user.userId, 'batch_platforms', ids, { accountIds: accounts });
    return res.json({ success: true, updated: ids.length });
  });

  // GET /posts/batch/export
  router.get('/posts/batch/export', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const postIds = req.query.postIds;
    const ids = Array.isArray(postIds)
      ? postIds.map((id) => String(id)).filter(Boolean)
      : typeof postIds === 'string'
        ? [String(postIds)]
        : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'Invalid postIds' });

    const { rows } = await pool!.query(
      `SELECT p.*, ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=p.id) AS tag_names
       FROM blog_posts p WHERE p.id = ANY($1) AND p.user_id=$2`,
      [ids, user.userId],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Posts not found' });

    const header = ['Title', 'Status', 'Scheduled At', 'Published At', 'Updated At', 'Tags'];
    const csv = [
      header.join(','),
      ...rows.map((row: any) => {
        const tags = Array.isArray(row.tag_names) ? row.tag_names.join(';') : '';
        return [
          `"${String(row.title || '').replace(/"/g, '""')}"`,
          row.status || '',
          row.scheduled_at ? new Date(row.scheduled_at).toISOString() : '',
          row.published_at ? new Date(row.published_at).toISOString() : '',
          row.updated_at ? new Date(row.updated_at).toISOString() : '',
          `"${String(tags).replace(/"/g, '""')}"`,
        ].join(',');
      }),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=posts.csv');
    return res.send(csv);
  });

  // POST /posts/batch/restore
  router.post('/posts/batch/restore', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { previousState = [] } = req.body as { previousState?: any[] };
    if (!Array.isArray(previousState) || previousState.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid previousState' });
    }
    const ids = previousState.map((p) => String(p.id)).filter(Boolean);
    const owned = await pool!.query('SELECT id FROM blog_posts WHERE id = ANY($1) AND user_id=$2', [ids, user.userId]);
    if (owned.rows.length !== ids.length) return res.status(403).json({ success: false, error: 'Not authorized' });

    for (const state of previousState) {
      const postId = String(state.id);
      await pool!.query(
        `UPDATE blog_posts SET title=$1, slug=$2, content=$3, excerpt=$4, featured_image=$5, status=$6, category_id=$7,
          meta_title=$8, meta_description=$9, focus_keyword=$10, social_title=$11, social_description=$12, social_image=$13,
          social_automation=$14, scheduled_at=$15, published_at=$16, updated_at=NOW()
         WHERE id=$17 AND user_id=$18`,
        [state.title || '', state.slug || '', state.content || '', state.excerpt || '', state.featured_image || '',
         state.status || 'draft', state.category_id || null, state.meta_title || '', state.meta_description || '',
         state.focus_keyword || '', state.social_title || '', state.social_description || '', state.social_image || '',
         JSON.stringify(state.social_automation || {}), state.scheduled_at || null, state.published_at || null,
         postId, user.userId],
      );

      const tagIds = Array.isArray(state.tag_ids) ? state.tag_ids.map((id: string) => String(id)) : [];
      await pool!.query('DELETE FROM blog_post_tags WHERE post_id=$1', [postId]);
      if (tagIds.length) {
        await pool!.query(
          `INSERT INTO blog_post_tags (post_id, tag_id) SELECT $1, t FROM UNNEST($2::text[]) AS t`,
          [postId, tagIds],
        );
      }
    }

    clearCalendarCacheForUser(user.userId);
    await recordAuditLog(user.userId, 'batch_restore', ids, {});
    return res.json({ success: true, restored: ids.length });
  });

  // POST /posts/:id/duplicate
  router.post('/posts/:id/duplicate', async (req: Request, res: Response) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const { id } = req.params;
    const { rows } = await pool!.query('SELECT * FROM blog_posts WHERE id=$1 AND user_id=$2', [id, user.userId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    const src = rows[0];
    const newId = randomUUID();
    const { rows: newRows } = await pool!.query(
      `INSERT INTO blog_posts (id,user_id,title,slug,content,excerpt,featured_image,status,category_id,
        meta_title,meta_description,focus_keyword,social_title,social_description,social_image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [newId, user.userId, `${src.title} (Copy)`, `${src.slug}-copy`, src.content, src.excerpt,
       src.featured_image, src.category_id, src.meta_title, src.meta_description, src.focus_keyword,
       src.social_title, src.social_description, src.social_image],
    );
    const tagRows = await pool!.query('SELECT tag_id FROM blog_post_tags WHERE post_id=$1', [id]);
    if (tagRows.rows.length) {
      await Promise.all(
        tagRows.rows.map((r: { tag_id: string }) =>
          pool!.query('INSERT INTO blog_post_tags (post_id,tag_id) VALUES ($1,$2)', [newId, r.tag_id]),
        ),
      );
    }
    clearCalendarCacheForUser(user.userId);
    return res.json({ success: true, post: newRows[0] });
  });

  // ── /api/v1/calendar and /api/v1/posts GET — registered on app (not on this router)
  // These live outside the /api/v1/blog/ namespace and are managed in server.ts.

  return router;
}
