export class NotificationService {
  static async sendEmail(_to: string, _subject: string, _body: string) {
    return { success: false, error: "Email service not configured" };
  }
}
