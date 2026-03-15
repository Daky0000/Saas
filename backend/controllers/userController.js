// User Controller
const { User, ConnectedAccount, Post, AuditLog } = require('../models');
const { AutomationRule, PostingSchedule, EvergreenPost, CaptionTemplate, AutomationLog } = require('../models');
const { Op } = require('sequelize');
const RuleManager = require('../automation/ruleManager');
const AutomationLogger = require('../automation/automationLogger');
const { schedulePost, removeJob } = require('../scheduler/scheduler');
const platforms = require('../platforms');
const { encrypt, decrypt } = require('../utils/encrypt');

const ruleManager = new RuleManager();
const logger = new AutomationLogger();

module.exports = {
  async getProfile(req, res) {
    try {
      const user = await User.findByPk(req.user.id);
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async updateProfile(req, res) {
    try {
      const user = await User.findByPk(req.user.id);
      await user.update(req.body);
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async connectAccount(req, res) {
    try {
      const { platform, token } = req.body;
      const encryptedToken = encrypt(token);
      const account = await ConnectedAccount.create({
        user_id: req.user.id,
        platform,
        token: encryptedToken
      });
      res.json(account);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async disconnectAccount(req, res) {
    try {
      await ConnectedAccount.destroy({
        where: { user_id: req.user.id, platform: req.body.platform }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async getPosts(req, res) {
    try {
      const where: any = { user_id: req.user.id };
      if (req.query.status) {
        where.status = req.query.status;
      }
      if (req.query.search) {
        // Basic search across title/content
        const search = String(req.query.search).trim();
        where[Op.or] = [
          { title: { [Op.like]: `%${search}%` } },
          { content: { [Op.like]: `%${search}%` } },
        ];
      }
      const posts = await Post.findAll({
        where,
        include: [ConnectedAccount],
      });
      res.json(posts);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async getCalendarPosts(req, res) {
    try {
      const { start_date, end_date, platform } = req.query;
      const where: any = { user_id: req.user.id };
      if (start_date && end_date) {
        where.scheduledAt = { [Op.between]: [new Date(String(start_date)), new Date(String(end_date))] };
      }
      if (platform) {
        where.platform = String(platform);
      }
      const posts = await Post.findAll({ where });
      res.json(posts);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async getUnscheduledPosts(req, res) {
    try {
      const posts = await Post.findAll({
        where: { user_id: req.user.id, scheduledAt: null, status: 'pending' },
      });
      res.json(posts);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async updatePostSchedule(req, res) {
    try {
      const postId = req.params.id;
      const { scheduled_at } = req.body;
      const post = await Post.findOne({ where: { id: postId, user_id: req.user.id } });
      if (!post) {
        return res.status(404).json({ error: 'Post not found' });
      }

      // Cancel any existing queued job
      if (post.jobId) {
        await removeJob(post.jobId).catch(() => null);
      }

      // Update schedule
      post.scheduledAt = scheduled_at ? new Date(scheduled_at) : null;
      post.status = scheduled_at ? 'scheduled' : post.status;
      await post.save();

      // Schedule via scheduler
      if (scheduled_at) {
        const jobId = await schedulePost(post.platform, post.toJSON ? post.toJSON() : post, { userId: req.user.id }, scheduled_at);
        post.jobId = jobId;
        await post.save();
      }

      res.json(post);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async createPost(req, res) {
    try {
      const post = await Post.create({
        ...req.body,
        user_id: req.user.id, // Assuming we add user_id to Post model
      });
      res.json(post);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async schedulePost(req, res) {
    try {
      const { postId, scheduledAt } = req.body;
      const post = await Post.findByPk(postId);
      await post.update({ scheduledAt, status: 'scheduled' });
      res.json(post);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async publishPost(req, res) {
    try {
      const { postId } = req.body;
      const post = await Post.findByPk(postId);
      await post.update({ status: 'published' });

      // Trigger automation
      const automationEngine = require('../automation/automationEngine');
      await automationEngine.onPostPublished(post, req.user.id);

      res.json(post);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Automation methods
  async getAutomationRules(req, res) {
    try {
      const rules = await AutomationRule.findAll({ where: { user_id: req.user.id } });
      res.json(rules);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async createAutomationRule(req, res) {
    try {
      const rule = await ruleManager.createRule(req.user.id, req.body);
      res.json(rule);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async updateAutomationRule(req, res) {
    try {
      const rule = await ruleManager.updateRule(req.params.id, req.user.id, req.body);
      res.json(rule);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async deleteAutomationRule(req, res) {
    try {
      await ruleManager.deleteRule(req.params.id, req.user.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async getPostingSchedules(req, res) {
    try {
      const schedules = await PostingSchedule.findAll({ where: { user_id: req.user.id } });
      res.json(schedules);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async setPostingSchedule(req, res) {
    try {
      const { platform, times, timezone } = req.body;
      const schedule = await ruleManager.setPostingSchedule(req.user.id, platform, times, timezone);
      res.json(schedule);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async getEvergreenPosts(req, res) {
    try {
      const evergreen = await ruleManager.getEvergreenPosts(req.user.id);
      res.json(evergreen);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async addEvergreenPost(req, res) {
    try {
      const { postId, intervalDays, maxReposts } = req.body;
      const evergreen = await ruleManager.addEvergreenPost(postId, intervalDays, maxReposts);
      res.json(evergreen);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async getCaptionTemplates(req, res) {
    try {
      const templates = await CaptionTemplate.findAll({ where: { user_id: req.user.id } });
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async setCaptionTemplate(req, res) {
    try {
      const { platform, templateText } = req.body;
      const template = await ruleManager.setCaptionTemplate(req.user.id, platform, templateText);
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async getAutomationLogs(req, res) {
    try {
      const logs = await logger.getLogs(req.user.id);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};