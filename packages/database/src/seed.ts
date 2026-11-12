// Seed the normal catalog and, when explicitly configured, the initial administrator.
import bcrypt from "bcryptjs";
import { prisma } from "./index";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("The development catalog seed cannot run in production.");

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!!adminEmail !== !!adminPassword) throw new Error("Set both SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to create the initial admin.");
  if (adminEmail && adminPassword) {
    if (adminPassword.length < 12) throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters.");
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: { email: adminEmail, passwordHash: await bcrypt.hash(adminPassword, 12), fullName: "Platform Admin", role: "ADMIN", emailVerifiedAt: new Date() },
    });
    if (admin.role !== "ADMIN") throw new Error("SEED_ADMIN_EMAIL already belongs to a non-admin user; no changes were made.");
  }

  const postingPlans = [
    { code: "FREE_JOB", name: "Free posting", description: "One standard job listing", pricePaise: 0, durationDays: 30, postingCredits: 1, featured: false, features: ["Standard listing", "Application tracking"] },
    { code: "STANDARD_JOB", name: "Standard posting", description: "A 30-day standard listing", pricePaise: 49900, durationDays: 30, postingCredits: 1, featured: false, features: ["Standard listing", "Application tracking", "Candidate search"] },
    { code: "FEATURED_JOB", name: "Featured posting", description: "A featured 30-day listing", pricePaise: 99900, durationDays: 30, postingCredits: 1, featured: true, features: ["Featured listing", "Application tracking", "Candidate search"] },
  ];
  for (const plan of postingPlans) await prisma.jobPostingPlan.upsert({ where: { code: plan.code }, update: {}, create: plan });
  const subscriptionPlans = [
    { code: "FREELANCE_BASIC", audience: "FREELANCE", name: "Basic", description: "Basic freelancer tools", amountPaise: 0, durationDays: 30, features: ["Recruiter profile", "Limited job posts"], active: true },
    { code: "FREELANCE_PRO", audience: "FREELANCE", name: "Professional", description: "For independent recruiters", amountPaise: 99900, durationDays: 30, features: ["More job posts", "Candidate search"], active: true },
    { code: "CORPORATE_GROWTH", audience: "CORPORATE", name: "Growth", description: "For hiring teams", amountPaise: 299900, durationDays: 30, features: ["Company profile", "Job management", "Candidate search"], active: true },
  ];
  for (const plan of subscriptionPlans) await prisma.subscriptionPlan.upsert({ where: { code: plan.code }, update: {}, create: plan });
  console.log("Seeded subscription and job posting plans.");
}

main().finally(() => prisma.$disconnect());
