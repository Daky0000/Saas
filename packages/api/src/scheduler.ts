import { logger } from './logger.ts';
import { pool, dbQuery, hasDatabase } from './db.ts';

// queueSocialAutomationForPublishedPost and fireWorkflowTriggers are defined in
// distributionRoutes.ts / workflowRoutes.ts and available via esbuild bundle scope.
declare function queueSocialAutomationForPublishedPost(userId: string, post: any): Promise<void>;
declare function fireWorkflowTriggers(userId: string, event: string, data: any): Promise<void>;

// Runs every hour. Sends a notification to each assignee of tasks due in ~24h.
export async function runDueDateAlerts() {
  try {
    const { rows } = await pool!.query<{
      task_id: string; title: string; due_date: string;
      user_id: string; project_id: string;
    }>(`
      SELECT t.id AS task_id, t.title, t.due_date, t.project_id,
             ta.user_id
      FROM tasks t
      JOIN task_assignees ta ON ta.task_id = t.id
      WHERE t.status != 'done'
        AND t.due_date IS NOT NULL
        AND t.due_date BETWEEN NOW() + INTERVAL '20 hours' AND NOW() + INTERVAL '28 hours'
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.user_id = ta.user_id
            AND n.type = 'task_due_soon'
            AND (n.data->>'task_id') = t.id::text
            AND n.created_at > NOW() - INTERVAL '24 hours'
        )
    `);
    for (const row of rows) {
      const due = new Date(row.due_date);
      const formatted = due.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      await pool!.query(
        `INSERT INTO notifications (user_id, type, title, message, data)
         VALUES ($1, 'task_due_soon', $2, $3, $4)`,
        [
          row.user_id,
          `Due tomorrow: "${row.title}"`,
          `Your task is due on ${formatted}. Make sure to complete it in time.`,
          JSON.stringify({ task_id: row.task_id, project_id: row.project_id }),
        ]
      );
    }
    if (rows.length > 0) logger.info({ count: rows.length }, 'due_date_alerts_sent');
  } catch (err) {
    logger.error({ err }, 'due_date_alert_error');
  }
}

// Runs every 2 minutes. Finds posts whose scheduled_at has passed, promotes them
// to published, fires social automation + workflow triggers for each.
export async function publishDuePosts() {
  if (!hasDatabase()) return;
  try {
    const { rows } = await pool!.query<{ id: string; user_id: string; title: string }>(
      `UPDATE blog_posts
       SET status = 'published', published_at = NOW(), updated_at = NOW()
       WHERE status = 'scheduled'
         AND scheduled_at IS NOT NULL
         AND scheduled_at <= NOW()
       RETURNING id, user_id, title`
    );
    if (!rows.length) return;

    for (const post of rows) {
      const { rows: full } = await pool!.query(
        `SELECT p.*,
          ARRAY(SELECT t.name FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = p.id) AS tag_names
         FROM blog_posts p WHERE p.id = $1`,
        [post.id]
      ).catch(() => ({ rows: [] }));

      if (full.length) {
        await queueSocialAutomationForPublishedPost(post.user_id, full[0]).catch(() => undefined);
        void fireWorkflowTriggers(post.user_id, 'post_published', full[0]);
      }

      await dbQuery(
        `INSERT INTO notifications (user_id, type, title, message, data)
         VALUES ($1, 'post', 'Post published', $2, $3)`,
        [
          post.user_id,
          `"${post.title}" was automatically published as scheduled.`,
          JSON.stringify({ post_id: post.id }),
        ]
      ).catch(() => undefined);
    }

    logger.info({ count: rows.length }, 'scheduled_posts_published');
  } catch (err) {
    logger.error({ err }, 'scheduled_posts_publish_error');
  }
}
