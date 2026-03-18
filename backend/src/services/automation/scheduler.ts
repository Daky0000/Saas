import { PrismaClient, PostStatus } from "@prisma/client";
import { addPostToQueue } from "./queue";

const prisma = new PrismaClient();
let started = false;

export const startScheduler = () => {
  if (started) return;
  started = true;

  setInterval(async () => {
    try {
      const now = new Date();
      const posts = await prisma.post.findMany({
        where: {
          status: PostStatus.SCHEDULED,
          scheduledAt: { lte: now },
        },
        select: { id: true },
      });

      for (const post of posts) {
        await addPostToQueue(post.id, null);
        await prisma.post.update({
          where: { id: post.id },
          data: { status: PostStatus.PENDING },
        });
      }
    } catch (error) {
      console.error("Scheduler error", error);
    }
  }, 60_000);
};
