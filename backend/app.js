// Main App Entry
const express = require('express');
const bodyParser = require('body-parser');
const { postQueue } = require('./scheduler/scheduler');
const userController = require('./controllers/userController');
const adminController = require('./controllers/adminController');
const WebhookListener = require('./controllers/webhooks');
const { encrypt, decrypt } = require('./utils/encrypt');
const { notifyUser, notifyAdmin } = require('./utils/notify');

const app = express();
app.use(bodyParser.json());

// User routes
app.get('/api/profile', userController.getProfile);
app.put('/api/profile', userController.updateProfile);
app.post('/api/connect', userController.connectAccount);
app.post('/api/disconnect', userController.disconnectAccount);
app.get('/api/posts', userController.getPosts);
app.post('/api/posts', userController.createPost);
app.post('/api/schedule', userController.schedulePost);

// Admin routes
app.get('/api/admin/users', adminController.getAllUsers);
app.get('/api/admin/posts', adminController.getAllPosts);
app.get('/api/admin/accounts', adminController.getAllConnectedAccounts);
app.post('/api/admin/retry', adminController.retryFailedPost);
app.get('/api/admin/audit', adminController.getAuditLogs);
app.post('/api/admin/tokens', adminController.manageTokens);
app.post('/api/admin/platform', adminController.updatePlatformConfig);

// Webhook endpoint
app.post('/api/webhook', async (req, res) => {
  await WebhookListener.handleEvent(req.body);
  res.sendStatus(200);
});

// Health check
app.get('/api/health', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));

module.exports = app;