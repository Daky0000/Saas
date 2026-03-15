// Evergreen Posts model
module.exports = (sequelize, DataTypes) => {
  const EvergreenPost = sequelize.define('EvergreenPost', {
    post_id: { type: DataTypes.INTEGER, allowNull: false },
    interval_days: { type: DataTypes.INTEGER, allowNull: false },
    max_reposts: { type: DataTypes.INTEGER, allowNull: false },
    repost_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    last_posted_at: { type: DataTypes.DATE }
  }, { tableName: 'evergreen_posts', timestamps: false });
  EvergreenPost.associate = models => {
    EvergreenPost.belongsTo(models.Post, { foreignKey: 'post_id' });
  };
  return EvergreenPost;
};