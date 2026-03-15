// Automation Logs model
module.exports = (sequelize, DataTypes) => {
  const AutomationLog = sequelize.define('AutomationLog', {
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    post_id: { type: DataTypes.INTEGER },
    platform: { type: DataTypes.STRING },
    action: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM('success', 'failed', 'pending'), allowNull: false },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, { tableName: 'automation_logs', timestamps: false });
  AutomationLog.associate = models => {
    AutomationLog.belongsTo(models.User, { foreignKey: 'user_id' });
    AutomationLog.belongsTo(models.Post, { foreignKey: 'post_id' });
  };
  return AutomationLog;
};