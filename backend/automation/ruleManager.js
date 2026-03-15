// Rule Manager - Handles automation rules CRUD
const { AutomationRule, PostingSchedule, EvergreenPost, CaptionTemplate } = require('../models');

class RuleManager {
  async getActiveRules(userId, triggerType) {
    return await AutomationRule.findAll({
      where: { user_id: userId, trigger_type: triggerType, status: 'active' }
    });
  }

  async createRule(userId, ruleData) {
    return await AutomationRule.create({ ...ruleData, user_id: userId });
  }

  async updateRule(ruleId, userId, updates) {
    const rule = await AutomationRule.findOne({ where: { id: ruleId, user_id: userId } });
    if (!rule) throw new Error('Rule not found');
    return await rule.update(updates);
  }

  async deleteRule(ruleId, userId) {
    const rule = await AutomationRule.findOne({ where: { id: ruleId, user_id: userId } });
    if (!rule) throw new Error('Rule not found');
    await rule.destroy();
  }

  async getPostingSchedule(userId, platform) {
    return await PostingSchedule.findOne({ where: { user_id: userId, platform } });
  }

  async setPostingSchedule(userId, platform, times, timezone) {
    const [schedule, created] = await PostingSchedule.findOrCreate({
      where: { user_id: userId, platform },
      defaults: { times, timezone }
    });
    if (!created) {
      await schedule.update({ times, timezone });
    }
    return schedule;
  }

  async getEvergreenPosts(userId) {
    // Get evergreen posts for user
    return await EvergreenPost.findAll({
      include: [{ model: require('../models').Post, where: { /* user association */ } }]
    });
  }

  async addEvergreenPost(postId, intervalDays, maxReposts) {
    return await EvergreenPost.create({ post_id: postId, interval_days: intervalDays, max_reposts: maxReposts });
  }

  async getCaptionTemplate(userId, platform) {
    return await CaptionTemplate.findOne({ where: { user_id: userId, platform } });
  }

  async setCaptionTemplate(userId, platform, templateText) {
    const [template, created] = await CaptionTemplate.findOrCreate({
      where: { user_id: userId, platform },
      defaults: { template_text: templateText }
    });
    if (!created) {
      await template.update({ template_text: templateText });
    }
    return template;
  }
}

module.exports = RuleManager;