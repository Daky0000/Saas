// Notification Utility
function notifyUser(userId, message) {
  // Send notification to user (email, in-app, etc.)
  console.log(`Notify user ${userId}: ${message}`);
}
function notifyAdmin(message) {
  // Send notification to admin
  console.log(`Notify admin: ${message}`);
}
module.exports = { notifyUser, notifyAdmin };