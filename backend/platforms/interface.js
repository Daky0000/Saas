// SocialPlatform Interface
export class SocialPlatform {
  async connectAccount(userToken) { throw new Error('Not implemented'); }
  async refreshToken() { throw new Error('Not implemented'); }
  async post(postObject) { throw new Error('Not implemented'); }
  validate(postObject) { throw new Error('Not implemented'); }
  async getPostAnalytics(postId) { throw new Error('Not implemented'); }
  handleError(error) { throw new Error('Not implemented'); }
}