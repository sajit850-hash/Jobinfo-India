import { PrismaClient } from "@prisma/client";

// Render deployments sometimes have only the direct Neon URL configured.
// Prefer the pooled URL for app traffic, but fall back to the direct URL when needed.
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
}

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

export * from "@prisma/client";
