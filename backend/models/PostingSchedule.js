// Posting Schedules model
module.exports = (sequelize, DataTypes) => {
  const PostingSchedule = sequelize.define('PostingSchedule', {
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    platform: { type: DataTypes.STRING, allowNull: false },
    times: { type: DataTypes.JSONB, allowNull: false }, // array of time strings like ['09:00', '14:00']
    timezone: { type: DataTypes.STRING, defaultValue: 'UTC' }
  }, { tableName: 'posting_schedules', timestamps: false });
  PostingSchedule.associate = models => {
    PostingSchedule.belongsTo(models.User, { foreignKey: 'user_id' });
  };
  return PostingSchedule;
};