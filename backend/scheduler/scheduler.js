// Scheduler Engine using BullMQ
const { Queue, Worker, QueueScheduler } = require('bullmq');
const limiter = require('bottleneck');
const { platforms } = require('../platforms');

const postQueue = new Queue('postQueue');
const postScheduler = new QueueScheduler('postQueue');

const rateLimiter = new limiter.Group({
  maxConcurrent: 5,
  minTime: 200 // 5 posts/sec
});

new Worker('postQueue', async job => {
  const { platformName, postObject } = job.data;
  const platform = platforms[platformName];
  try {
    await rateLimiter.key(platformName).schedule(() => platform.post(postObject));
  } catch (err) {
    platform.handleError(err);
    throw err;
  }
}, { concurrency: 5 });

module.exports = { postQueue, postScheduler, rateLimiter };