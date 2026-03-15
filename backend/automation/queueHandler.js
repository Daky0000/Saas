// Queue Handler - Sends generated jobs to the scheduler
const { postQueue } = require('../scheduler/scheduler');

class QueueHandler {
  async sendToQueue(job) {
    if (!postQueue) {
      console.warn('[QueueHandler] Queue not available, job not queued');
      return;
    }

    const { scheduledAt, ...jobData } = job;

    if (scheduledAt) {
      // Schedule for later
      await postQueue.add(jobData, { delay: scheduledAt.getTime() - Date.now() });
    } else {
      // Add immediately
      await postQueue.add(jobData);
    }

    console.log(`[QueueHandler] Job queued for ${job.platformName}`);
  }
}

module.exports = QueueHandler;