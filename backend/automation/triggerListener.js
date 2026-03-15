// Trigger Listener - Listens for system events
const EventEmitter = require('events');

class TriggerListener extends EventEmitter {
  constructor(automationEngine) {
    super();
    this.automationEngine = automationEngine;
  }

  async startListening() {
    // Hook into post publishing events
    // This would be integrated with the post controller
    this.on('postPublished', this.handlePostPublished.bind(this));
    this.on('delayedTrigger', this.handleDelayedTrigger.bind(this));
    this.on('evergreenTrigger', this.handleEvergreenTrigger.bind(this));
  }

  async handlePostPublished({ post, userId }) {
    await this.automationEngine.onPostPublished(post, userId);
  }

  async handleDelayedTrigger({ userId }) {
    await this.automationEngine.onDelayedTrigger(userId);
  }

  async handleEvergreenTrigger() {
    await this.automationEngine.onEvergreenTrigger();
  }

  // Method to emit events from outside
  emitPostPublished(post, userId) {
    this.emit('postPublished', { post, userId });
  }

  emitDelayedTrigger(userId) {
    this.emit('delayedTrigger', { userId });
  }

  emitEvergreenTrigger() {
    this.emit('evergreenTrigger');
  }
}

module.exports = TriggerListener;