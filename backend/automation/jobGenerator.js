// Job Generator - Creates platform publishing jobs from rules
const RuleManager = require('./ruleManager');
const { Post, ConnectedAccount } = require('../models');
const { decrypt } = require('../utils/encrypt');

class JobGenerator {
  constructor() {
    this.ruleManager = new RuleManager();
  }

  async generateJobs(rule, post, userId) {
    const jobs = [];
    const platforms = rule.platforms;

    for (const platform of platforms) {
      const connectedAccount = await ConnectedAccount.findOne({
        where: { user_id: userId, platform }
      });

      if (!connectedAccount) continue; // Skip if not connected

      // Get caption template
      const template = await this.ruleManager.getCaptionTemplate(userId, platform);
      const caption = template ? this.applyTemplate(template.template_text, post) : post.content.text;

      // Get posting schedule for timing
      const schedule = await this.ruleManager.getPostingSchedule(userId, platform);
      let scheduledAt = null;

      if (rule.trigger_type === 'post_published' && rule.delay_minutes > 0) {
        scheduledAt = new Date(Date.now() + rule.delay_minutes * 60 * 1000);
      } else if (schedule) {
        scheduledAt = this.getNextScheduledTime(schedule.times, schedule.timezone);
      }

      const job = {
        platformName: platform,
        postObject: {
          ...post,
          content: { ...post.content, text: caption },
          connectedAccountId: connectedAccount.id,
          token: decrypt(connectedAccount.token) // Decrypt token for use
        },
        ctx: { userId, ruleId: rule.id, postId: post.id },
        scheduledAt
      };

      jobs.push(job);
    }

    return jobs;
  }

  applyTemplate(template, post) {
    return template
      .replace('{title}', post.title || '')
      .replace('{excerpt}', post.excerpt || '')
      .replace('{content}', post.content?.text || '')
      .replace('{link}', post.link || '')
      .replace('{hashtags}', post.hashtags || '');
  }

  getNextScheduledTime(times, timezone) {
    // Simple implementation - pick the next time slot
    const now = new Date();
    // For simplicity, assume UTC for now
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();

    for (const time of times) {
      const [hour, minute] = time.split(':').map(Number);
      if (hour > currentHour || (hour === currentHour && minute > currentMinute)) {
        const scheduled = new Date(now);
        scheduled.setUTCHours(hour, minute, 0, 0);
        return scheduled;
      }
    }

    // If no time today, schedule for tomorrow first slot
    const [hour, minute] = times[0].split(':').map(Number);
    const scheduled = new Date(now);
    scheduled.setUTCDate(scheduled.getUTCDate() + 1);
    scheduled.setUTCHours(hour, minute, 0, 0);
    return scheduled;
  }
}

module.exports = JobGenerator;