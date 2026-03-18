import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_AGENCY = "Default Agency";

const ensureAgency = async () => {
  let agency = await prisma.agency.findFirst({ where: { name: DEFAULT_AGENCY } });
  if (!agency) {
    agency = await prisma.agency.create({ data: { name: DEFAULT_AGENCY } });
  }
  return agency;
};

const isUsernameAvailable = async (username: string, email?: string) => {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) return true;
  return email ? existing.email === email : false;
};

const upsertUser = async ({
  email,
  username,
  password,
  role,
  agencyId,
}: {
  email: string;
  username: string;
  password: string;
  role: "ADMIN" | "MANAGER" | "VIEWER";
  agencyId: string;
}) => {
  const hashed = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { email } });

  const usernameToUse = (await isUsernameAvailable(username, email))
    ? username
    : undefined;

  if (existing) {
    return prisma.user.update({
      where: { email },
      data: {
        password: hashed,
        role,
        agencyId,
        ...(usernameToUse ? { username: usernameToUse } : {}),
      },
    });
  }

  return prisma.user.create({
    data: {
      email,
      username: usernameToUse,
      password: hashed,
      firstName: "",
      lastName: "",
      role,
      agencyId,
    },
  });
};

export const seedDefaultUsers = async () => {
  if (process.env.SEED_DEFAULT_USERS !== "true") return;

  try {
    const agency = await ensureAgency();

    await upsertUser({
      email: "admin@example.com",
      username: "admin",
      password: "admin",
      role: "ADMIN",
      agencyId: agency.id,
    });

    await upsertUser({
      email: "user@example.com",
      username: "user",
      password: "user",
      role: "MANAGER",
      agencyId: agency.id,
    });

    console.log("Default users ensured.");
  } catch (error) {
    console.error("Default user seeding failed:", error);
  }
};
