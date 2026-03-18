import { PrismaClient, PostStatus } from "@prisma/client";

const prisma = new PrismaClient();

export class PostService {
  static async getPostById(id: string, agencyId: string) {
    return prisma.post.findFirst({
      where: { id, agencyId },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
    });
  }

  static async listPosts(agencyId: string, status?: PostStatus) {
    return prisma.post.findMany({
      where: { agencyId, ...(status ? { status } : {}) },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
