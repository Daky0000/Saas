// Main App Entry
const express = require('express');
const bodyParser = require('body-parser');
const { syncDatabase } = require('./models');
const { createQueue } = require('./scheduler/scheduler');
const userController = require('./controllers/userController');
const adminController = require('./controllers/adminController');
const WebhookListener = require('./controllers/webhooks');
const { encrypt, decrypt } = require('./utils/encrypt');
const { notifyUser, notifyAdmin } = require('./utils/notify');
const AutomationEngine = require('./automation/automationEngine');
const platforms = require('./platforms');

const app = express();
app.use(bodyParser.json());

// Initialize database
syncDatabase().catch(console.error);

// Initialize scheduler
createQueue(platforms);

// Initialize automation engine
const automationEngine = new AutomationEngine();
automationEngine.initialize().catch(console.error);

// User routes
app.get('/api/profile', userController.getProfile);
app.put('/api/profile', userController.updateProfile);
app.post('/api/connect', userController.connectAccount);
app.post('/api/disconnect', userController.disconnectAccount);
app.get('/api/posts', userController.getPosts);
app.post('/api/posts', userController.createPost);
app.post('/api/schedule', userController.schedulePost);
app.post('/api/publish', userController.publishPost);

// Automation routes
app.get('/api/calendar/posts', userController.getCalendarPosts);
app.get('/api/posts/unscheduled', userController.getUnscheduledPosts);
app.patch('/api/posts/:id/schedule', userController.updatePostSchedule);

app.get('/api/automation/rules', userController.getAutomationRules);
app.post('/api/automation/rules', userController.createAutomationRule);
app.put('/api/automation/rules/:id', userController.updateAutomationRule);
app.delete('/api/automation/rules/:id', userController.deleteAutomationRule);
app.get('/api/automation/schedules', userController.getPostingSchedules);
app.post('/api/automation/schedules', userController.setPostingSchedule);
app.get('/api/automation/evergreen', userController.getEvergreenPosts);
app.post('/api/automation/evergreen', userController.addEvergreenPost);
app.get('/api/automation/templates', userController.getCaptionTemplates);
app.post('/api/automation/templates', userController.setCaptionTemplate);
app.get('/api/automation/logs', userController.getAutomationLogs);

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