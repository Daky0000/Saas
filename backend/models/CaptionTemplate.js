// Caption Templates model
module.exports = (sequelize, DataTypes) => {
  const CaptionTemplate = sequelize.define('CaptionTemplate', {
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    platform: { type: DataTypes.STRING, allowNull: false },
    template_text: { type: DataTypes.TEXT, allowNull: false }
  }, { tableName: 'caption_templates', timestamps: false });
  CaptionTemplate.associate = models => {
    CaptionTemplate.belongsTo(models.User, { foreignKey: 'user_id' });
  };
  return CaptionTemplate;
};