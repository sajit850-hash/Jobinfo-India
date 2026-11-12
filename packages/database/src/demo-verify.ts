import { readFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { prisma } from "./index";

async function main() {
  const batchKey = process.env.DEMO_DATA_BATCH_KEY || "jobinfo-demo-v1";
  const batch = await prisma.demoSeedBatch.findUnique({ where: { batchKey } });
  if (!batch) throw new Error(`Missing demo batch ${batchKey}`);
  const tracked = await prisma.demoDataRecord.groupBy({ by: ["recordType"], where: { batchId: batch.id, deletedAt: null }, _count: { _all: true } });
  const counts = Object.fromEntries(tracked.map(row => [row.recordType, row._count._all]));
  const expected: Record<string, number> = { User: 38, Company: 5, Candidate: 20, Employer: 10, Job: 30, JobSkill: 90, JobRequirement: 60, Institution: 5, InstitutionStudent: 50, Application: 40, AdminProfile: 3, ApplicationStatusHistory: 75, SavedJob: 20, Interview: 10, CandidateProfileView: 15, Notification: 30, SubscriptionPlan: 3, Subscription: 3, PaymentTransaction: 3, TaxInvoice: 3, AuditLog: 3 };
  for (const [type, count] of Object.entries(expected)) if (counts[type] !== count) throw new Error(`${type} count mismatch: expected ${count}, found ${counts[type] || 0}`);
  const [candidates, students, jobsWithSkills, apps, shortlisted, interviews, savedJobs, notifications, demoTransactions, sharedCompany, missingOwnership, demoUsersWithNonDemoPhones, studentsWithNonDemoPhones, credentials] = await Promise.all([
    prisma.candidate.count({ where: { id: { startsWith: "demo-candidate-" }, profileComplete: true, searchable: true } }),
    prisma.institutionStudent.count({ where: { id: { startsWith: "demo-student-" }, recruiterVisible: true } }),
    prisma.job.count({ where: { id: { startsWith: "demo-job-" }, skills: { some: {} } } }),
    prisma.application.count({ where: { id: { startsWith: "demo-application-" } } }),
    prisma.application.count({ where: { id: { startsWith: "demo-application-" }, status: "SHORTLISTED" } }),
    prisma.interview.count({ where: { id: { startsWith: "demo-interview-" } } }),
    prisma.savedJob.count({ where: { candidateId: { startsWith: "demo-candidate-" }, jobId: { startsWith: "demo-job-" } } }),
    prisma.notification.count({ where: { id: { startsWith: "demo-notification-" } } }),
    prisma.paymentTransaction.count({ where: { id: { startsWith: "demo-payment-" }, status: "DEMO", amountPaise: 0 } }),
    prisma.company.count({ where: { id: { startsWith: "demo-company-" }, recruiters: { some: {} } } }),
    prisma.user.count({ where: { email: { endsWith: "@jobinfo-demo.test" }, OR: [{ emailVerifiedAt: null }, { phoneVerifiedAt: null }, { registrationStatus: { not: "REGISTRATION_COMPLETED" } }] } }),
    prisma.user.count({ where: { email: { endsWith: "@jobinfo-demo.test" }, NOT: { phone: { startsWith: "+910" } } } }),
    prisma.institutionStudent.count({ where: { id: { startsWith: "demo-student-" }, NOT: { phone: { startsWith: "+910" } } } }),
    readFile(path.resolve(process.cwd(), ".local", "demo-credentials.txt"), "utf8"),
  ]);
  const lines = credentials.split(/\r?\n/).filter(line => /@jobinfo-demo\.test\t/.test(line));
  if (lines.length !== 38) throw new Error(`Expected 38 local credential entries, found ${lines.length}`);
  for (const line of lines) {
    const [role, userId, email, password] = line.split("\t");
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, isActive: true, passwordHash: true } });
    if (!user || user.id !== userId || !user.isActive || user.role !== role || !await bcrypt.compare(password, user.passwordHash)) throw new Error(`Credential verification failed for ${email}`);
  }
  const observed = { candidates, students, jobsWithSkills, apps, shortlisted, interviews, savedJobs, notifications, demoTransactions, sharedCompany, missingOwnership, demoUsersWithNonDemoPhones, studentsWithNonDemoPhones };
  if (candidates !== 20 || students !== 50 || jobsWithSkills !== 30 || apps !== 40 || shortlisted !== 15 || interviews !== 10 || savedJobs !== 20 || notifications !== 30 || demoTransactions !== 3 || sharedCompany !== 5 || missingOwnership !== 0 || demoUsersWithNonDemoPhones !== 0 || studentsWithNonDemoPhones !== 0) throw new Error(`Profile, student, application, company, or registration verification failed: ${JSON.stringify(observed)}`);
  console.log(JSON.stringify({ batch: batch.batchKey, status: batch.status, recordCounts: counts, activeCandidates: candidates, visibleStudents: students, jobsWithSkills, applications: apps, shortlistedApplications: shortlisted, interviews, savedJobs, notifications, demoTransactions, companiesWithRecruiters: sharedCompany, completeVerifiedUsers: 38, safePhonePlaceholders: true, credentialLoginsVerified: lines.length }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Demo verification failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
