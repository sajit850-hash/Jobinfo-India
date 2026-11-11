// Sample data matching the Landing Page prototype. Dev only.
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { prisma } from "./index";

const companies = [
  { name: "TechNova Pvt Ltd", city: "Bengaluru", verified: true },
  { name: "Sagenext Infotech", city: "Gorakhpur", verified: true },
  { name: "FinEdge Corp", city: "Delhi", verified: false },
  { name: "TalentBridge", city: "Mumbai", verified: true },
  { name: "InsightLabs", city: "Pune", verified: true },
  { name: "CloudServe", city: "Lucknow", verified: false },
];

const jobs = [
  { c: 0, title: "Software Developer", category: "IT & Software", exp: [2, 5], sal: [8, 12] },
  { c: 1, title: "Sales Manager", category: "Sales & Marketing", exp: [3, 6], sal: [5, 8] },
  { c: 2, title: "Accountant", category: "Banking & Finance", exp: [1, 3], sal: [4, 6] },
  { c: 3, title: "HR Recruiter", category: "HR & Admin", exp: [1, 2], sal: [3, 5] },
  { c: 4, title: "Data Analyst", category: "IT & Software", exp: [2, 4], sal: [6, 9] },
  { c: 5, title: "Customer Support", category: "Sales & Marketing", exp: [0, 0], sal: [2, 4] },
];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("The demo seed cannot run in production.");

  if (process.env.SEED_DEMO_ACCOUNTS === "true") {
    const demoPassword = process.env.SEED_DEMO_PASSWORD || "JobinfoDemo!2026";
    if (demoPassword.length < 12) throw new Error("SEED_DEMO_PASSWORD must be at least 12 characters.");
    const passwordHash = await bcrypt.hash(demoPassword, 12);
    const verifiedAt = new Date();

    const candidateUser = await prisma.user.upsert({
      where: { email: "demo.candidate@example.com" },
      update: { passwordHash, fullName: "Demo Candidate", role: "CANDIDATE", isActive: true, emailVerifiedAt: verifiedAt, phoneVerifiedAt: verifiedAt },
      create: { email: "demo.candidate@example.com", passwordHash, fullName: "Demo Candidate", role: "CANDIDATE", isActive: true, emailVerifiedAt: verifiedAt, phoneVerifiedAt: verifiedAt, candidate: { create: { headline: "Software Engineer", city: "Bengaluru", state: "Karnataka", experienceYears: 3, profileComplete: true, searchable: true } } },
    });
    if (candidateUser.role !== "CANDIDATE") throw new Error("Demo candidate email belongs to another role.");
    const candidate = await prisma.candidate.upsert({
      where: { userId: candidateUser.id },
      update: { headline: "Software Engineer", city: "Bengaluru", state: "Karnataka", experienceYears: 3, profileComplete: true, searchable: true },
      create: { userId: candidateUser.id, headline: "Software Engineer", city: "Bengaluru", state: "Karnataka", experienceYears: 3, profileComplete: true, searchable: true },
    });
    await prisma.candidateSkill.createMany({ data: ["TypeScript", "React", "Node.js", "PostgreSQL"].map((name) => ({ candidateId: candidate.id, name })), skipDuplicates: true });

    const recruiterUsers = [
      { email: "demo.corporate@example.com", fullName: "Demo Corporate Recruiter", company: "Demo Corporate Ltd", recruiterType: "CORPORATE" },
      { email: "demo.freelance@example.com", fullName: "Demo Freelance Recruiter", company: "Demo Talent Search", recruiterType: "FREELANCE" },
    ];
    for (const demo of recruiterUsers) {
      const user = await prisma.user.upsert({
        where: { email: demo.email },
        update: { passwordHash, fullName: demo.fullName, role: "RECRUITER", isActive: true, emailVerifiedAt: verifiedAt },
        create: { email: demo.email, passwordHash, fullName: demo.fullName, role: "RECRUITER", isActive: true, emailVerifiedAt: verifiedAt },
      });
      if (user.role !== "RECRUITER") throw new Error(`Demo recruiter email ${demo.email} belongs to another role.`);
      await prisma.employer.upsert({
        where: { userId: user.id },
        update: { name: demo.company, city: "Bengaluru", recruiterType: demo.recruiterType, verified: true },
        create: { userId: user.id, name: demo.company, city: "Bengaluru", recruiterType: demo.recruiterType, verified: true },
      });
    }

    const institutionUser = await prisma.user.upsert({
      where: { email: "demo.institution@example.com" },
      update: { passwordHash, fullName: "Demo Institution Admin", role: "INSTITUTION", isActive: true, emailVerifiedAt: verifiedAt },
      create: { email: "demo.institution@example.com", passwordHash, fullName: "Demo Institution Admin", role: "INSTITUTION", isActive: true, emailVerifiedAt: verifiedAt },
    });
    if (institutionUser.role !== "INSTITUTION") throw new Error("Demo institution email belongs to another role.");
    const institution = await prisma.institution.upsert({
      where: { userId: institutionUser.id },
      update: { name: "Demo Institute of Technology", city: "Bengaluru", state: "Karnataka", verified: true },
      create: { userId: institutionUser.id, name: "Demo Institute of Technology", city: "Bengaluru", state: "Karnataka", verified: true },
    });
    const department = await prisma.department.findFirst({ where: { institutionId: institution.id, name: "Computer Science" } });
    if (!department) await prisma.department.create({ data: { institutionId: institution.id, name: "Computer Science" } });
    await prisma.institutionStudent.upsert({
      where: { institutionId_email: { institutionId: institution.id, email: "student@example.com" } },
      update: { fullName: "Demo Student", department: "Computer Science", degree: "B.Tech", passingYear: new Date().getFullYear(), skills: ["TypeScript", "React"], recruiterVisible: true },
      create: { institutionId: institution.id, fullName: "Demo Student", email: "student@example.com", department: "Computer Science", degree: "B.Tech", passingYear: new Date().getFullYear(), skills: ["TypeScript", "React"], recruiterVisible: true },
    });

    const adminUser = await prisma.user.upsert({
      where: { email: "demo.admin@example.com" },
      update: { passwordHash, fullName: "Demo Administrator", role: "ADMIN", isActive: true, emailVerifiedAt: verifiedAt },
      create: { email: "demo.admin@example.com", passwordHash, fullName: "Demo Administrator", role: "ADMIN", isActive: true, emailVerifiedAt: verifiedAt },
    });
    if (adminUser.role !== "ADMIN") throw new Error("Demo admin email belongs to another role.");
    console.log("Seeded development test accounts (candidate, corporate recruiter, freelance recruiter, institution and admin).");
  }

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
  // Demo users receive a random password unless a local-only password is explicitly supplied.
  const passwordHash = await bcrypt.hash(process.env.SEED_DEMO_PASSWORD || randomBytes(32).toString("hex"), 12);
  const employers = [];
  for (const [i, co] of companies.entries()) {
    const user = await prisma.user.upsert({
      where: { email: `seed-employer-${i}@example.com` },
      update: {},
      create: {
        email: `seed-employer-${i}@example.com`,
        passwordHash,
        fullName: `${co.name} HR`,
        role: "RECRUITER",
      },
    });
    if (user.role !== "RECRUITER") throw new Error(`Seed email ${user.email} belongs to a non-recruiter user.`);
    employers.push(await prisma.employer.upsert({
      where: { userId: user.id },
      update: { name: co.name, city: co.city, verified: co.verified },
      create: { userId: user.id, name: co.name, city: co.city, verified: co.verified },
    }));
  }
  for (const j of jobs) {
    const e = employers[j.c];
    const jobReference = `seed-${j.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    await prisma.job.upsert({
      where: { jobReference },
      update: {
        employerId: e.id,
        title: j.title,
        description: `${j.title} role at ${e.name}. Sample listing for development.`,
        location: e.city ?? "India",
        category: j.category,
        experienceMin: j.exp[0],
        experienceMax: j.exp[1],
        salaryMin: j.sal[0],
        salaryMax: j.sal[1],
        featured: true,
        status: "PUBLISHED",
      },
      create: {
        jobReference,
        employerId: e.id,
        title: j.title,
        description: `${j.title} role at ${e.name}. Sample listing for development.`,
        location: e.city ?? "India",
        category: j.category,
        experienceMin: j.exp[0],
        experienceMax: j.exp[1],
        salaryMin: j.sal[0],
        salaryMax: j.sal[1],
        featured: true,
        status: "PUBLISHED",
      },
    });
  }
  console.log("Seeded", employers.length, "employers and", jobs.length, "jobs");
}

main().finally(() => prisma.$disconnect());
