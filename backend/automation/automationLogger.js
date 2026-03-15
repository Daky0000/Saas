// Automation Logger - Tracks automation actions
const { AutomationLog } = require('../models');

class AutomationLogger {
  async log(userId, postId, platform, action, status) {
    await AutomationLog.create({
      user_id: userId,
      post_id: postId,
      platform,
      action,
      status
    });
  }

  async getLogs(userId, limit = 100) {
    return await AutomationLog.findAll({
      where: { user_id: userId },
      order: [['created_at', 'DESC']],
      limit
    });
  }
}

module.exports = AutomationLogger;