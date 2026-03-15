const { Sequelize } = require('sequelize');
const path = require('path');

// Database configuration
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './database.sqlite',
  logging: console.log,
  define: {
    timestamps: true,
    underscored: true,
  },
});

// Import models
const User = require('./User')(sequelize, Sequelize.DataTypes);
const ConnectedAccount = require('./ConnectedAccount')(sequelize, Sequelize.DataTypes);
const Post = require('./Post')(sequelize, Sequelize.DataTypes);
const AuditLog = require('./AuditLog')(sequelize, Sequelize.DataTypes);

// Automation models
const AutomationRule = require('./AutomationRule')(sequelize, Sequelize.DataTypes);
const PostingSchedule = require('./PostingSchedule')(sequelize, Sequelize.DataTypes);
const EvergreenPost = require('./EvergreenPost')(sequelize, Sequelize.DataTypes);
const CaptionTemplate = require('./CaptionTemplate')(sequelize, Sequelize.DataTypes);
const AutomationLog = require('./AutomationLog')(sequelize, Sequelize.DataTypes);

// Define associations
User.hasMany(ConnectedAccount, { foreignKey: 'user_id', onDelete: 'CASCADE' });
ConnectedAccount.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(Post, { foreignKey: 'user_id', onDelete: 'CASCADE' });
Post.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(AuditLog, { foreignKey: 'user_id', onDelete: 'CASCADE' });
AuditLog.belongsTo(User, { foreignKey: 'user_id' });

// Automation associations
User.hasMany(AutomationRule, { foreignKey: 'user_id', onDelete: 'CASCADE' });
AutomationRule.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(PostingSchedule, { foreignKey: 'user_id', onDelete: 'CASCADE' });
PostingSchedule.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(EvergreenPost, { foreignKey: 'user_id', onDelete: 'CASCADE' });
EvergreenPost.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(CaptionTemplate, { foreignKey: 'user_id', onDelete: 'CASCADE' });
CaptionTemplate.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(AutomationLog, { foreignKey: 'user_id', onDelete: 'CASCADE' });
AutomationLog.belongsTo(User, { foreignKey: 'user_id' });

Post.hasMany(AutomationLog, { foreignKey: 'post_id', onDelete: 'SET NULL' });
AutomationLog.belongsTo(Post, { foreignKey: 'post_id' });

AutomationRule.hasMany(AutomationLog, { foreignKey: 'rule_id', onDelete: 'SET NULL' });
AutomationLog.belongsTo(AutomationRule, { foreignKey: 'rule_id' });

// Sync database (create tables)
const syncDatabase = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    // Sync all models
    await sequelize.sync({ alter: true });
    console.log('Database synchronized successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    throw error;
  }
};

module.exports = {
  sequelize,
  Sequelize,
  User,
  ConnectedAccount,
  Post,
  AuditLog,
  AutomationRule,
  PostingSchedule,
  EvergreenPost,
  CaptionTemplate,
  AutomationLog,
  syncDatabase,
};