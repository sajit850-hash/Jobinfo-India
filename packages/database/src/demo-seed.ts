import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { prisma } from "./index";

const batchKeyBase = process.env.DEMO_DATA_BATCH_KEY || "jobinfo-demo-v1";
let batchKey = batchKeyBase;
const isStaging = process.env.DEMO_DATA_ENVIRONMENT === "staging" && !!process.env.NEON_BRANCH && !/production|main/i.test(process.env.NEON_BRANCH);
const isAuthorizedProduction = process.env.NODE_ENV === "production"
  && process.env.DEMO_DATA_ENVIRONMENT === "production"
  && process.env.DEMO_DATA_PRODUCTION_ENABLED === "true"
  && process.env.NEON_BRANCH === "production";
if (process.env.DEMO_DATA_ENABLED !== "true" || (process.env.NODE_ENV === "production" && !isStaging && !isAuthorizedProduction)) {
  throw new Error("Demo seeding requires DEMO_DATA_ENABLED=true and development, authorized staging, or explicit production opt-in on the production Neon branch.");
}

const departments = ["Engineering", "Product", "Data Science", "Business", "Design", "Human Resources"];
const skills = ["TypeScript", "React", "Node.js", "PostgreSQL", "Python", "SQL", "Figma", "Recruitment", "Digital Marketing", "Excel", "Java", "AWS"];
const locations = [["Bengaluru", "Karnataka"], ["Mumbai", "Maharashtra"], ["Pune", "Maharashtra"], ["Hyderabad", "Telangana"], ["Jaipur", "Rajasthan"], ["Delhi", "Delhi"]];
const names = ["Aarav Mehta", "Diya Sharma", "Ishaan Rao", "Ananya Nair", "Vivaan Shah", "Saanvi Iyer", "Aditya Kulkarni", "Aditi Das", "Arjun Reddy", "Meera Joshi", "Kabir Sethi", "Riya Kapoor", "Reyansh Gupta", "Myra Menon", "Dev Malhotra", "Sara Khan", "Krish Patel", "Tara Bose", "Neil Thomas", "Ira Verma"];
const companies = ["Blue Banyan Technologies", "Copper Kite Analytics", "Monsoon Pixel Labs", "Riverstone People Co.", "Marigold Systems"];
const institutions = ["Western Ghats Institute of Technology", "Deccan School of Management", "Coastal Polytechnic College", "Aravalli State University", "Indus Skills Academy"];
const jobs = ["Frontend Engineer", "Backend Engineer", "Data Analyst", "Product Designer", "Talent Acquisition Partner", "Technical Support Engineer", "Digital Marketing Specialist", "Finance Associate", "QA Automation Engineer", "Cloud Platform Engineer"];
let credentialLines: string[] = [];
async function userData(kind: string, index: number, role: "CANDIDATE" | "RECRUITER" | "INSTITUTION" | "ADMIN", fullName: string) {
  const email = `${kind}${String(index + 1).padStart(3, "0")}@jobinfo-demo.test`;
  const id = `demo-${kind}-${String(index + 1).padStart(3, "0")}`;
  const password = randomBytes(20).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 12);
  credentialLines.push(`${role}\t${id}\t${email}\t${password}`);
  const phoneOffset = ({ candidate: 0, recruiter: 100, institution: 200, admin: 300 } as Record<string, number>)[kind] ?? 900;
  // India has no safe public pool of routable test mobiles; the leading zero makes these placeholders non-dialable.
  const phone = `+910${String(phoneOffset + index + 1).padStart(9, "0")}`;
  return { id, email, phone, passwordHash, fullName, role, isActive: true, emailVerifiedAt: new Date(), phoneVerifiedAt: new Date(), termsAcceptedAt: new Date(), registrationStatus: "REGISTRATION_COMPLETED" as const };
}

async function main() {
  let existingBatch = await prisma.demoSeedBatch.findUnique({ where: { batchKey }, include: { _count: { select: { records: true } } } });
  if (existingBatch?.status === "ACTIVE" && existingBatch._count.records) { console.log(`Batch ${batchKey} already contains ${existingBatch._count.records} tracked records; no changes made.`); return; }
  if (existingBatch?.status === "DELETED") { batchKey = `${batchKeyBase}-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`; existingBatch = null; }
  if (process.argv.includes("--dry-run")) { console.log(`Dry run: would create 20 candidates, 10 recruiters, 5 institutions, 3 admins, 5 companies, 50 students, 30 jobs, 40 applications, 20 saved jobs, 15 shortlist statuses, 10 interviews, and 30 notifications in batch ${batchKey}. No database changes made.`); return; }
  credentialLines = ["Jobinfo India demo accounts", `Batch: ${batchKey}`, `Environment: ${process.env.DEMO_DATA_ENVIRONMENT || "development"}`, `Generated: ${new Date().toISOString()}`, "Keep this ignored local file private. Passwords are not stored in the database.", ""];
  const accountSpecs: { kind: string; count: number; role: "CANDIDATE" | "RECRUITER" | "INSTITUTION" | "ADMIN"; names: string[] }[] = [
    { kind: "candidate", count: 20, role: "CANDIDATE", names },
    { kind: "recruiter", count: 10, role: "RECRUITER", names: ["Kavya Rao", "Rohan Mehta", "Nisha Shah", "Anil Menon", "Pooja Iyer", "Rahul Das", "Neha Kulkarni", "Armaan Khan", "Sonal Patel", "Kunal Bose"] },
    { kind: "institution", count: 5, role: "INSTITUTION", names: ["Dr. Ritu Sinha", "Prof. Mohan Pillai", "Dr. Leena George", "Prof. Ajay Bhat", "Ms. Nandita Roy"] },
    { kind: "admin", count: 3, role: "ADMIN", names: ["Demo Super Admin", "Demo Operations Admin", "Demo Finance Admin"] },
  ];
  const users: Record<string, Awaited<ReturnType<typeof userData>>[]> = {};
  for (const spec of accountSpecs) users[spec.kind] = await Promise.all(Array.from({ length: spec.count }, (_, i) => userData(spec.kind, i, spec.role, spec.names[i % spec.names.length])));
  const emails = Object.values(users).flat().map(x => x.email);
  if (await prisma.user.findFirst({ where: { email: { in: emails } }, select: { email: true } })) throw new Error("A demo email already belongs to a user. Refusing to modify or overwrite that account.");
  const batchId = `batch-${batchKey}`;
  const record = async (tx: any, recordType: string, recordId: string, userId?: string) => tx.demoDataRecord.create({ data: { batchId, recordType, recordId, userId } });
  const companyIds = companies.map((_, i) => `demo-company-${i + 1}`);
  const instIds = institutions.map((_, i) => `demo-institution-profile-${i + 1}`);
  await prisma.$transaction(async tx => {
    await tx.demoSeedBatch.upsert({ where: { batchKey }, create: { id: batchId, batchKey, label: "Jobinfo India staging dashboard demo data" }, update: { status: "ACTIVE" } });
    for (let i = 0; i < companies.length; i++) {
      const city = locations[i][0], state = locations[i][1];
      await tx.company.create({ data: { id: companyIds[i], name: companies[i], website: `https://company${i + 1}.jobinfo-demo.test`, industry: departments[i], size: ["51-200", "201-500", "11-50", "51-200", "501-1000"][i], description: `Fictional demo ${departments[i].toLowerCase()} employer for staging workflow checks.`, address: `${10 + i} Demo Park`, city, state, verified: true } });
      await record(tx, "Company", companyIds[i]);
    }
    for (let i = 0; i < 20; i++) {
      const u = users.candidate[i], [city, state] = locations[i % locations.length], exp = i % 5 === 0 ? 0 : (i % 9) + 1;
      await tx.user.create({ data: u }); await record(tx, "User", u.id, u.id);
      const candidateId = `demo-candidate-${String(i + 1).padStart(3, "0")}`;
      await tx.candidate.create({ data: { id: candidateId, userId: u.id, headline: `${skills[i % skills.length]} ${exp ? "Professional" : "Graduate"}`, summary: "Fictional staging profile for end-to-end dashboard checks.", city, state, resumeUrl: `demo://resume/${candidateId}`, profilePhotoKey: `demo-avatar-${i + 1}`, passingYear: exp ? undefined : 2025, experienceYears: exp, profileComplete: true, searchable: true, dateOfBirth: new Date(1995 + (i % 8), i % 12, 12), gender: i % 2 ? "Female" : "Male", currentAddress: `${i + 1} Demo Residency`, country: "India", highestQualification: i % 3 ? "Bachelor's Degree" : "Master's Degree", course: ["Computer Science", "Commerce", "Business Administration", "Design", "Human Resources"][i % 5], expectedSalary: 400000 + i * 50000, preferredJobLocations: [city, "Remote"], preferredJobRoles: [jobs[i % jobs.length]], employmentType: "FULL_TIME", workMode: "HYBRID", languages: ["English", "Hindi"], skills: { create: [...new Set([skills[i % skills.length], skills[(i + 2) % skills.length], skills[(i + 5) % skills.length]])].map(name => ({ name })) }, education: { create: [{ institution: institutions[i % institutions.length], degree: i % 3 ? "Bachelor of Technology" : "Master of Business Administration", field: departments[i % departments.length], passingYear: 2018 + (i % 8) }, { institution: "Demo Senior Secondary School", degree: "Senior Secondary", passingYear: 2014 + (i % 7) }] }, ...(exp ? { workExperience: { create: [{ company: companies[i % companies.length], title: jobs[i % jobs.length], location: city, description: "Fictional work history for demo candidate search.", startDate: new Date(2020, i % 12, 1), current: true }] } } : {}) } });
      await record(tx, "Candidate", candidateId, u.id);
      await tx.certification.create({ data: { id: `demo-cert-${i + 1}`, candidateId, name: ["Cloud Foundations", "Recruiting Essentials", "Analytics with SQL", "Digital Design Basics"][i % 4], issuer: "Jobinfo Demo Academy", issueYear: 2024 } }); await record(tx, "Certification", `demo-cert-${i + 1}`, u.id);
    }
    for (let i = 0; i < 10; i++) {
      const u = users.recruiter[i], city = locations[i % locations.length][0], state = locations[i % locations.length][1];
      await tx.user.create({ data: u }); await record(tx, "User", u.id, u.id);
      const employerId = `demo-employer-${i + 1}`;
      await tx.employer.create({ data: { id: employerId, userId: u.id, name: companies[i % companies.length], companyId: companyIds[i % companies.length], website: `https://company${(i % 5) + 1}.jobinfo-demo.test`, industry: departments[i % departments.length], city, state, recruiterType: i % 3 === 0 ? "FREELANCE" : "CORPORATE", recruiterDesignation: i % 3 === 0 ? "Independent Recruiter" : "Talent Acquisition Manager", recruiterDepartment: "Human Resources", recruiterLinkedinUrl: `https://www.linkedin.com/in/demo-recruiter-${i + 1}`, companySize: "51-200", description: "Fictional employer profile for staging workflow checks.", verified: true, hiringDepartments: [departments[i % departments.length]], hiringLocations: [city] } }); await record(tx, "Employer", employerId, u.id);
    }
    const jobIds: string[] = [];
    for (let i = 0; i < 30; i++) {
      const employerId = `demo-employer-${(i % 10) + 1}`, [city, state] = locations[i % locations.length], id = `demo-job-${String(i + 1).padStart(3, "0")}`; jobIds.push(id);
      const jobSkills = [...new Set([skills[i % skills.length], skills[(i + 3) % skills.length], skills[(i + 6) % skills.length]])];
      await tx.job.create({ data: { id, employerId, title: jobs[i % jobs.length], description: `Join our fictional ${departments[i % departments.length].toLowerCase()} team. This staging job demonstrates searching, filtering and candidate applications.`, location: `${city}, ${state}`, city, state, country: "India", category: departments[i % departments.length], department: departments[i % departments.length], employmentType: "FULL_TIME", experienceMin: i % 5, experienceMax: (i % 5) + 5, salaryMin: 5 + (i % 8), salaryMax: 10 + (i % 10), openings: 1 + (i % 4), workplaceType: i % 3 ? "HYBRID" : "REMOTE", status: "PUBLISHED", publishedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 86400000), applicationDeadline: new Date(Date.now() + 45 * 86400000), slug: `demo-job-${String(i + 1).padStart(3, "0")}`, jobReference: `DEMO-${String(i + 1).padStart(4, "0")}`, requiredQualifications: "Relevant degree or equivalent experience; portfolio or work examples welcome.", technicalRequirements: jobSkills.join(", "), salaryDisclosure: true, skills: { create: jobSkills.map((name, k) => ({ id: `demo-jobskill-${i + 1}-${k + 1}`, name, kind: k === 2 ? "PREFERRED" : "REQUIRED" })) }, requirements: { create: [{ id: `demo-jobreq-${i + 1}-education`, kind: "EDUCATION", name: "Bachelor's degree or equivalent" }, { id: `demo-jobreq-${i + 1}-experience`, kind: "EXPERIENCE", name: `${i % 5}+ years relevant experience` }] } } }); await record(tx, "Job", id, users.recruiter[(i % 10)].id);
      await tx.demoDataRecord.createMany({ data: jobSkills.flatMap((_, k) => [{ batchId, recordType: "JobSkill", recordId: `demo-jobskill-${i + 1}-${k + 1}`, userId: users.recruiter[i % 10].id }]).concat([{ batchId, recordType: "JobRequirement", recordId: `demo-jobreq-${i + 1}-education`, userId: users.recruiter[i % 10].id }, { batchId, recordType: "JobRequirement", recordId: `demo-jobreq-${i + 1}-experience`, userId: users.recruiter[i % 10].id }]) });
    }
    for (let i = 0; i < 5; i++) {
      const u = users.institution[i], [city, state] = locations[i];
      await tx.user.create({ data: u }); await record(tx, "User", u.id, u.id);
      const institutionId = instIds[i];
      await tx.institution.create({ data: { id: institutionId, userId: u.id, name: institutions[i], website: `https://college${i + 1}.jobinfo-demo.test`, city, state, verified: true, institutionType: ["Engineering College", "Management College", "Polytechnic", "University", "Training Institute"][i], category: "Higher Education", establishedYear: 1990 + i * 4, affiliation: "Demo State Technical Board", accreditation: "Demo accreditation profile", description: "Fictional institution profile; student profiles are demo data.", address: `${i + 1} Campus Road`, country: "India", studentStrength: 500 + i * 150, passingYears: [2024, 2025, 2026] } }); await record(tx, "Institution", institutionId, u.id);
      for (const dept of departments.slice(0, 4)) { const id = `demo-dept-${i + 1}-${dept.toLowerCase().replace(/\s+/g, "-")}`; await tx.department.create({ data: { id, institutionId, name: dept } }); await record(tx, "Department", id, u.id); }
      for (const course of ["Bachelor of Technology", "Bachelor of Business Administration", "Diploma in Computer Engineering"]) { const id = `demo-course-${i + 1}-${course.toLowerCase().replace(/\s+/g, "-")}`; await tx.institutionCourse.create({ data: { id, institutionId, name: course } }); await record(tx, "InstitutionCourse", id, u.id); }
      for (let j = 0; j < 10; j++) {
        const n = i * 10 + j, id = `demo-student-${String(n + 1).padStart(3, "0")}`, student = await tx.institutionStudent.create({ data: { id, institutionId, fullName: names[n % names.length], email: `student${String(n + 1).padStart(3, "0")}@jobinfo-demo.test`, phone: `+910${String(400 + n + 1).padStart(9, "0")}`, department: departments[j % 4], degree: ["B.Tech", "BBA", "Diploma"][j % 3], passingYear: 2024 + (j % 3), skills: [skills[n % skills.length], skills[(n + 3) % skills.length]], headline: "Fictional graduating student", profileSummary: "Staging student record with demo-only recruiter visibility.", recruiterVisible: true, placementStatus: j % 4 === 0 ? "PLACED" : "SEEKING" } }); await record(tx, "InstitutionStudent", student.id, u.id);
        if (j % 4 === 0) { const placement = await tx.institutionPlacement.create({ data: { id: `demo-placement-${n + 1}`, studentId: id, companyName: companies[j % companies.length], jobTitle: jobs[j % jobs.length], status: "PLACED", placedAt: new Date(2025, 5, 1), notes: "Fictional demo placement record." } }); await record(tx, "InstitutionPlacement", placement.id, u.id); }
      }
    }
    const applicationStatuses = Array.from({ length: 40 }, (_, i) => i < 15 ? "SHORTLISTED" : i < 25 ? "INTERVIEW" : i < 30 ? "REJECTED" : i < 35 ? "VIEWED" : "APPLIED");
    const applicationRows = Array.from({ length: 40 }, (_, i) => ({ id: `demo-application-${String(i + 1).padStart(3, "0")}`, candidateId: `demo-candidate-${String((i * 7) % 20 + 1).padStart(3, "0")}`, jobId: jobIds[(i * 11) % jobIds.length], status: applicationStatuses[i] as any, coverLetter: "I am interested in this fictional demo opportunity and believe my experience is relevant.", appliedAt: new Date(Date.now() - i * 86400000) }));
    await tx.application.createMany({ data: applicationRows });
    await tx.demoDataRecord.createMany({ data: applicationRows.map(row => ({ batchId, recordType: "Application", recordId: row.id })) });
    const historyRows = applicationRows.flatMap((app, i) => [
      { id: `demo-apphist-${i + 1}-applied`, applicationId: app.id, previousStatus: null, newStatus: "APPLIED", note: "Application received in demo data." },
      ...(app.status !== "APPLIED" ? [{ id: `demo-apphist-${i + 1}-status`, applicationId: app.id, previousStatus: "APPLIED", newStatus: app.status, note: "Demo pipeline status for dashboard testing." }] : []),
    ]);
    await tx.applicationStatusHistory.createMany({ data: historyRows as any });
    await tx.demoDataRecord.createMany({ data: historyRows.map(row => ({ batchId, recordType: "ApplicationStatusHistory", recordId: row.id })) });
    const savedJobs = Array.from({ length: 20 }, (_, i) => ({ candidateId: `demo-candidate-${String(i + 1).padStart(3, "0")}`, jobId: jobIds[(i * 3) % jobIds.length] }));
    await tx.savedJob.createMany({ data: savedJobs });
    await tx.demoDataRecord.createMany({ data: savedJobs.map((row, i) => ({ batchId, recordType: "SavedJob", recordId: `${row.candidateId}:${row.jobId}`, userId: users.candidate[i].id })) });
    const interviews = Array.from({ length: 10 }, (_, i) => ({ id: `demo-interview-${String(i + 1).padStart(3, "0")}`, applicationId: applicationRows[i + 15].id, recruiterId: users.recruiter[((i + 15) * 11 % jobIds.length) % 10].id, scheduledAt: new Date(Date.now() + (i + 2) * 86400000), status: "SCHEDULED", mode: i % 2 ? "PHONE" : "VIDEO", location: i % 2 ? "Bengaluru" : null, meetingUrl: i % 2 ? null : `https://meet.jobinfo-demo.test/interview-${i + 1}`, notes: "Fictional interview schedule for staging workflow testing." }));
    await tx.interview.createMany({ data: interviews });
    await tx.demoDataRecord.createMany({ data: interviews.map(row => ({ batchId, recordType: "Interview", recordId: row.id, userId: row.recruiterId })) });
    const profileViews = Array.from({ length: 15 }, (_, i) => ({ id: `demo-profile-view-${String(i + 1).padStart(3, "0")}`, candidateId: `demo-candidate-${String(i + 1).padStart(3, "0")}`, recruiterId: users.recruiter[i % users.recruiter.length].id, source: "DEMO_CANDIDATE_SEARCH", viewedAt: new Date(Date.now() - i * 3600000) }));
    await tx.candidateProfileView.createMany({ data: profileViews });
    await tx.demoDataRecord.createMany({ data: profileViews.map(row => ({ batchId, recordType: "CandidateProfileView", recordId: row.id, userId: row.recruiterId })) });
    const notificationRows = Array.from({ length: 30 }, (_, i) => ({ id: `demo-notification-${String(i + 1).padStart(3, "0")}`, userId: i < 20 ? users.candidate[i].id : users.recruiter[i - 20].id, title: i < 20 ? "Application status update" : "New applicant activity", body: "This is a fictional Jobinfo staging notification.", createdAt: new Date(Date.now() - i * 3600000) }));
    await tx.notification.createMany({ data: notificationRows });
    await tx.demoDataRecord.createMany({ data: notificationRows.map(row => ({ batchId, recordType: "Notification", recordId: row.id, userId: row.userId })) });
    const permissionSets = [
      ["MANAGE_USERS", "MANAGE_REGISTRATIONS", "MANAGE_PRICING", "MANAGE_BILLING", "MANAGE_CMS", "MANAGE_TEMPLATES", "MODERATE_JOBS", "MANAGE_INSTITUTIONS", "VIEW_REPORTS", "VIEW_AUDIT", "MANAGE_INTEGRATIONS", "MANAGE_DEMO_DATA"],
      ["MANAGE_USERS", "MANAGE_REGISTRATIONS", "MODERATE_JOBS", "MANAGE_INSTITUTIONS", "VIEW_REPORTS", "MANAGE_DEMO_DATA"],
      ["MANAGE_BILLING", "MANAGE_PRICING", "VIEW_REPORTS", "MANAGE_DEMO_DATA"],
    ];
    for (let i = 0; i < 3; i++) { const u = users.admin[i]; await tx.user.create({ data: u }); await record(tx, "User", u.id, u.id); const id = `demo-admin-profile-${i + 1}`; await tx.adminProfile.create({ data: { id, userId: u.id, accessLevel: ["SUPER_ADMIN", "OPERATIONS_ADMIN", "FINANCE_ADMIN"][i], permissions: permissionSets[i] } }); await record(tx, "AdminProfile", id, u.id); const auditId = `demo-audit-${i + 1}`; await tx.auditLog.create({ data: { id: auditId, actorId: u.id, action: "DEMO_ACCOUNT_CREATED", entityType: "DemoSeedBatch", entityId: batchId, metadata: { accessLevel: ["SUPER_ADMIN", "OPERATIONS_ADMIN", "FINANCE_ADMIN"][i], demo: true } } }); await record(tx, "AuditLog", auditId, u.id); }
    const demoPlans = [
      { id: "demo-sub-plan-freelance", code: "DEMO_FREELANCE", audience: "FREELANCE", name: "Demo Freelance", description: "Zero-value staging plan.", amountPaise: 0, durationDays: 30, features: ["Demo recruiter account", "Staging only"], limits: { demo: true }, active: true },
      { id: "demo-sub-plan-corporate", code: "DEMO_CORPORATE", audience: "CORPORATE", name: "Demo Corporate", description: "Zero-value staging plan.", amountPaise: 0, durationDays: 30, features: ["Demo company account", "Staging only"], limits: { demo: true }, active: true },
      { id: "demo-sub-plan-institution", code: "DEMO_INSTITUTION", audience: "INSTITUTION", name: "Demo Institution", description: "Zero-value staging plan.", amountPaise: 0, durationDays: 30, features: ["Demo institution account", "Staging only"], limits: { demo: true }, active: true },
    ];
    await tx.subscriptionPlan.createMany({ data: demoPlans });
    await tx.demoDataRecord.createMany({ data: demoPlans.map(row => ({ batchId, recordType: "SubscriptionPlan", recordId: row.id })) });
    const subscriptionSpecs = [
      { user: users.recruiter[0], plan: "DEMO_FREELANCE", audience: "FREELANCE" },
      { user: users.recruiter[1], plan: "DEMO_CORPORATE", audience: "CORPORATE" },
      { user: users.institution[0], plan: "DEMO_INSTITUTION", audience: "INSTITUTION" },
    ];
    for (let i = 0; i < subscriptionSpecs.length; i++) {
      const spec = subscriptionSpecs[i], subscriptionId = `demo-subscription-${i + 1}`, paymentId = `demo-payment-${i + 1}`, invoiceId = `demo-invoice-${i + 1}`;
      await tx.subscription.create({ data: { id: subscriptionId, userId: spec.user.id, planCode: spec.plan, status: "ACTIVE", amountPaise: 0, audience: spec.audience, durationDays: 30, limits: { demo: true }, startedAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000) } }); await record(tx, "Subscription", subscriptionId, spec.user.id);
      await tx.paymentTransaction.create({ data: { id: paymentId, userId: spec.user.id, subscriptionId, provider: "demo", providerRef: `demo-payment-ref-${i + 1}`, amountPaise: 0, taxPaise: 0, status: "DEMO" } }); await record(tx, "PaymentTransaction", paymentId, spec.user.id);
      await tx.taxInvoice.create({ data: { id: invoiceId, invoiceNumber: `DEMO-INV-${String(i + 1).padStart(4, "0")}`, userId: spec.user.id, paymentId, subtotalPaise: 0, gstRateBps: 0, gstPaise: 0, totalPaise: 0, legalName: "Fictional Demo Account", billingAddress: "Demo Address, India", placeOfSupply: "Demo State", sellerLegalName: "Jobinfo India Demo Environment", sellerAddress: "Demo Address, India" } }); await record(tx, "TaxInvoice", invoiceId, spec.user.id);
    }
  }, { maxWait: 15000, timeout: 600000 });
  await mkdir(path.resolve(process.cwd(), ".local"), { recursive: true });
  const reportName = isAuthorizedProduction ? "demo-credentials-production.txt" : "demo-credentials.txt";
  await writeFile(path.resolve(process.cwd(), ".local", reportName), credentialLines.join("\n") + "\n", { mode: 0o600 });
  console.log(`Created demo batch ${batchKey} with 20 candidates, 10 recruiters, 5 institutions, 3 admins, 50 students, 30 jobs and 40 applications. Credentials: packages/database/.local/${reportName}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Demo seed failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
