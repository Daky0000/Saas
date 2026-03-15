// Automation Rules model
module.exports = (sequelize, DataTypes) => {
  const AutomationRule = sequelize.define('AutomationRule', {
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    rule_name: { type: DataTypes.STRING, allowNull: false },
    trigger_type: { type: DataTypes.ENUM('post_published', 'delayed', 'evergreen'), allowNull: false },
    platforms: { type: DataTypes.JSONB, allowNull: false }, // array of platform names
    delay_minutes: { type: DataTypes.INTEGER, defaultValue: 0 },
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, { tableName: 'automation_rules', timestamps: false });
  AutomationRule.associate = models => {
    AutomationRule.belongsTo(models.User, { foreignKey: 'user_id' });
  };
  return AutomationRule;
};