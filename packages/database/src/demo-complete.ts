import { prisma } from "./index";

const batchKey = process.env.DEMO_DATA_BATCH_KEY || "jobinfo-demo-v1";
async function main() {
  const staging = process.env.DEMO_DATA_ENVIRONMENT === "staging" && !!process.env.NEON_BRANCH && !/production|main/i.test(process.env.NEON_BRANCH);
  const authorizedProduction = process.env.NODE_ENV === "production" && process.env.DEMO_DATA_ENVIRONMENT === "production" && process.env.DEMO_DATA_PRODUCTION_ENABLED === "true" && process.env.NEON_BRANCH === "production";
  if (process.env.DEMO_DATA_ENABLED !== "true" || (process.env.NODE_ENV === "production" && !staging && !authorizedProduction)) throw new Error("Demo completion requires development, authorized staging, or explicit production opt-in on the production Neon branch.");
  const batch = await prisma.demoSeedBatch.findUnique({ where: { batchKey } });
  if (!batch || batch.status !== "ACTIVE") throw new Error(`Active demo batch ${batchKey} was not found.`);
  const mark = (recordType: string, recordId: string, userId?: string) => ({ batchId: batch.id, recordType, recordId, userId });
  const appStatuses = Array.from({ length: 40 }, (_, index) => index < 15 ? "SHORTLISTED" : index < 25 ? "INTERVIEW" : index < 30 ? "REJECTED" : index < 35 ? "VIEWED" : "APPLIED");
  const applicationIds = Array.from({ length: 40 }, (_, index) => `demo-application-${String(index + 1).padStart(3, "0")}`);
  const jobSkills = ["TypeScript", "React", "Node.js", "PostgreSQL", "Python", "SQL", "Figma", "Recruitment", "Digital Marketing", "Excel", "Java", "AWS"];
  const jobSkillRows = Array.from({ length: 30 }, (_, i) => [...new Set([jobSkills[i % jobSkills.length], jobSkills[(i + 3) % jobSkills.length], jobSkills[(i + 6) % jobSkills.length]])].map((name, k) => ({ id: `demo-jobskill-${i + 1}-${k + 1}`, jobId: `demo-job-${String(i + 1).padStart(3, "0")}`, name, kind: k === 2 ? "PREFERRED" : "REQUIRED" })) ).flat();
  const jobRequirementRows = Array.from({ length: 30 }, (_, i) => [
    { id: `demo-jobreq-${i + 1}-education`, jobId: `demo-job-${String(i + 1).padStart(3, "0")}`, kind: "EDUCATION", name: "Bachelor's degree or equivalent" },
    { id: `demo-jobreq-${i + 1}-experience`, jobId: `demo-job-${String(i + 1).padStart(3, "0")}`, kind: "EXPERIENCE", name: `${i % 5}+ years relevant experience` },
  ]).flat();
  const histories = applicationIds.flatMap((applicationId, index) => [
    { id: `demo-apphist-${index + 1}-applied`, applicationId, previousStatus: null, newStatus: "APPLIED", note: "Application received in demo data." },
    ...(appStatuses[index] !== "APPLIED" ? [{ id: `demo-apphist-${index + 1}-status`, applicationId, previousStatus: "APPLIED", newStatus: appStatuses[index], note: "Demo pipeline status for dashboard testing." }] : []),
  ]);
  const savedJobs = Array.from({ length: 20 }, (_, i) => ({ candidateId: `demo-candidate-${String(i + 1).padStart(3, "0")}`, jobId: `demo-job-${String(((i * 3) % 30) + 1).padStart(3, "0")}` }));
  const interviews = Array.from({ length: 10 }, (_, i) => ({ id: `demo-interview-${String(i + 1).padStart(3, "0")}`, applicationId: applicationIds[i + 15], recruiterId: `demo-recruiter-${String((((i + 15) * 11) % 30) % 10 + 1).padStart(3, "0")}`, scheduledAt: new Date(Date.now() + (i + 2) * 86400000), status: "SCHEDULED", mode: i % 2 ? "PHONE" : "VIDEO", location: i % 2 ? "Bengaluru" : null, meetingUrl: i % 2 ? null : `https://meet.jobinfo-demo.test/interview-${i + 1}`, notes: "Fictional interview schedule for staging workflow testing." }));
  const views = Array.from({ length: 15 }, (_, i) => ({ id: `demo-profile-view-${String(i + 1).padStart(3, "0")}`, candidateId: `demo-candidate-${String(i + 1).padStart(3, "0")}`, recruiterId: `demo-recruiter-${String(i % 10 + 1).padStart(3, "0")}`, source: "DEMO_CANDIDATE_SEARCH", viewedAt: new Date(Date.now() - i * 3600000) }));
  const notifications = Array.from({ length: 30 }, (_, i) => ({ id: `demo-notification-${String(i + 1).padStart(3, "0")}`, userId: i < 20 ? `demo-candidate-${String(i + 1).padStart(3, "0")}` : `demo-recruiter-${String(i - 19).padStart(3, "0")}`, title: i < 20 ? "Application status update" : "New applicant activity", body: "This is a fictional Jobinfo staging notification.", createdAt: new Date(Date.now() - i * 3600000) }));
  const billingUsers = ["demo-recruiter-001", "demo-recruiter-002", "demo-institution-001"];
  const demoPlans = [
    { id: "demo-sub-plan-freelance", code: "DEMO_FREELANCE", audience: "FREELANCE", name: "Demo Freelance", description: "Zero-value staging plan.", amountPaise: 0, durationDays: 30, features: ["Demo recruiter account", "Staging only"], limits: { demo: true }, active: true },
    { id: "demo-sub-plan-corporate", code: "DEMO_CORPORATE", audience: "CORPORATE", name: "Demo Corporate", description: "Zero-value staging plan.", amountPaise: 0, durationDays: 30, features: ["Demo company account", "Staging only"], limits: { demo: true }, active: true },
    { id: "demo-sub-plan-institution", code: "DEMO_INSTITUTION", audience: "INSTITUTION", name: "Demo Institution", description: "Zero-value staging plan.", amountPaise: 0, durationDays: 30, features: ["Demo institution account", "Staging only"], limits: { demo: true }, active: true },
  ];
  const subscriptionRows = billingUsers.map((userId, i) => ({ id: `demo-subscription-${i + 1}`, userId, planCode: demoPlans[i].code, status: "ACTIVE", amountPaise: 0, audience: ["FREELANCE", "CORPORATE", "INSTITUTION"][i], durationDays: 30, limits: { demo: true }, startedAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000) }));
  const payments = billingUsers.map((userId, i) => ({ id: `demo-payment-${i + 1}`, userId, subscriptionId: `demo-subscription-${i + 1}`, provider: "demo", providerRef: `demo-payment-ref-${i + 1}`, amountPaise: 0, taxPaise: 0, status: "DEMO" }));
  const invoices = billingUsers.map((userId, i) => ({ id: `demo-invoice-${i + 1}`, invoiceNumber: `DEMO-INV-${String(i + 1).padStart(4, "0")}`, userId, paymentId: `demo-payment-${i + 1}`, subtotalPaise: 0, gstRateBps: 0, gstPaise: 0, totalPaise: 0, legalName: "Fictional Demo Account", billingAddress: "Demo Address, India", placeOfSupply: "Demo State", sellerLegalName: "Jobinfo India Demo Environment", sellerAddress: "Demo Address, India" }));
  const adminAudit = [1, 2, 3].map(i => ({ id: `demo-audit-${i}`, actorId: `demo-admin-${String(i).padStart(3, "0")}`, action: "DEMO_ACCOUNT_CREATED", entityType: "DemoSeedBatch", entityId: batch.id, metadata: { accessLevel: ["SUPER_ADMIN", "OPERATIONS_ADMIN", "FINANCE_ADMIN"][i - 1], demo: true } }));
  await prisma.$transaction(async tx => {
    await tx.subscriptionPlan.createMany({ data: demoPlans, skipDuplicates: true });
    await tx.jobSkill.createMany({ data: jobSkillRows, skipDuplicates: true });
    await tx.jobRequirement.createMany({ data: jobRequirementRows, skipDuplicates: true });
    await tx.application.updateMany({ where: { id: { in: applicationIds.slice(0, 15) } }, data: { status: "SHORTLISTED" } });
    await tx.application.updateMany({ where: { id: { in: applicationIds.slice(15, 25) } }, data: { status: "INTERVIEW" } });
    await tx.application.updateMany({ where: { id: { in: applicationIds.slice(25, 30) } }, data: { status: "REJECTED" } });
    await tx.application.updateMany({ where: { id: { in: applicationIds.slice(30, 35) } }, data: { status: "VIEWED" } });
    await tx.application.updateMany({ where: { id: { in: applicationIds.slice(35, 40) } }, data: { status: "APPLIED" } });
    await tx.applicationStatusHistory.createMany({ data: histories as any, skipDuplicates: true });
    await tx.savedJob.createMany({ data: savedJobs, skipDuplicates: true });
    await tx.interview.createMany({ data: interviews, skipDuplicates: true });
    await tx.candidateProfileView.createMany({ data: views, skipDuplicates: true });
    await tx.notification.createMany({ data: notifications, skipDuplicates: true });
    await tx.subscription.createMany({ data: subscriptionRows, skipDuplicates: true });
    await tx.paymentTransaction.createMany({ data: payments, skipDuplicates: true });
    await tx.taxInvoice.createMany({ data: invoices, skipDuplicates: true });
    await tx.auditLog.createMany({ data: adminAudit, skipDuplicates: true });
    const rows = [
      ...histories.map(row => mark("ApplicationStatusHistory", row.id)),
      ...jobSkillRows.map(row => { const jobNumber = Number(row.jobId.split("-").pop()); return mark("JobSkill", row.id, `demo-recruiter-${String((jobNumber - 1) % 10 + 1).padStart(3, "0")}`); }),
      ...jobRequirementRows.map(row => { const jobNumber = Number(row.jobId.split("-").pop()); return mark("JobRequirement", row.id, `demo-recruiter-${String((jobNumber - 1) % 10 + 1).padStart(3, "0")}`); }),
      ...demoPlans.map(row => mark("SubscriptionPlan", row.id)),
      ...savedJobs.map(row => mark("SavedJob", `${row.candidateId}:${row.jobId}`, row.candidateId.replace("demo-candidate-", "demo-candidate-"))),
      ...interviews.map(row => mark("Interview", row.id, row.recruiterId)), ...views.map(row => mark("CandidateProfileView", row.id, row.recruiterId)),
      ...notifications.map(row => mark("Notification", row.id, row.userId)), ...subscriptionRows.map(row => mark("Subscription", row.id, row.userId)),
      ...payments.map(row => mark("PaymentTransaction", row.id, row.userId)), ...invoices.map(row => mark("TaxInvoice", row.id, row.userId)),
      ...adminAudit.map(row => mark("AuditLog", row.id, row.actorId || undefined)),
    ];
    await tx.demoDataRecord.createMany({ data: rows, skipDuplicates: true });
  }, { maxWait: 15000, timeout: 120000 });
  console.log(`Demo activity connected for ${batchKey}; repeat runs safely skip duplicate records.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Demo completion failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
