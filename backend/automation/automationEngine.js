// Automation Engine - Central controller for post automation
const RuleManager = require('./ruleManager');
const TriggerListener = require('./triggerListener');
const JobGenerator = require('./jobGenerator');
const QueueHandler = require('./queueHandler');
const AutomationLogger = require('./automationLogger');

class AutomationEngine {
  constructor() {
    this.ruleManager = new RuleManager();
    this.triggerListener = new TriggerListener(this);
    this.jobGenerator = new JobGenerator();
    this.queueHandler = new QueueHandler();
    this.logger = new AutomationLogger();
  }

  async initialize() {
    await this.triggerListener.startListening();
    console.log('[AutomationEngine] Initialized');
  }

  // Called when a post is published
  async onPostPublished(post, userId) {
    console.log(`[AutomationEngine] Post published: ${post.id} by user ${userId}`);
    await this.logger.log(userId, post.id, null, 'post_published', 'pending');

    const rules = await this.ruleManager.getActiveRules(userId, 'post_published');
    for (const rule of rules) {
      await this.processRule(rule, post, userId);
    }
  }

  // Called for delayed posting
  async onDelayedTrigger(userId) {
    const rules = await this.ruleManager.getActiveRules(userId, 'delayed');
    // Process delayed rules - this would be called by a scheduler
  }

  // Called for evergreen reposting
  async onEvergreenTrigger() {
    // Check for posts that need reposting
  }

  async processRule(rule, post, userId) {
    try {
      const jobs = await this.jobGenerator.generateJobs(rule, post, userId);
      for (const job of jobs) {
        await this.queueHandler.sendToQueue(job);
      }
      await this.logger.log(userId, post.id, null, 'rule_processed', 'success');
    } catch (error) {
      console.error(`[AutomationEngine] Error processing rule ${rule.id}:`, error);
      await this.logger.log(userId, post.id, null, 'rule_processed', 'failed');
    }
  }
}

module.exports = AutomationEngine;