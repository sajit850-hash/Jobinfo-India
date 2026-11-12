import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { test } from "node:test";

const enabled = process.env.ALLOW_REGISTRATION_TESTS === "true"
  && !!process.env.REGISTRATION_TEST_DATABASE_URL
  && !!process.env.REGISTRATION_TEST_DATABASE_URL_UNPOOLED
  && !!process.env.REGISTRATION_TEST_BRANCH_HOST;

test("candidate, recruiter, and institution registration persist on the Neon staging branch", { skip: !enabled }, async () => {
  process.env.NODE_ENV = "development";
  process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
  process.env.DATABASE_URL = process.env.REGISTRATION_TEST_DATABASE_URL;
  process.env.DATABASE_URL_UNPOOLED = process.env.REGISTRATION_TEST_DATABASE_URL_UNPOOLED;

  const { prisma } = await import("@jobinfo/database");
  const [{ authRouter }, { candidatesRouter }, { recruitersRouter }, { institutionsRouter }] = await Promise.all([
    import("./routes/auth"),
    import("./routes/candidates"),
    import("./routes/recruiters"),
    import("./routes/institutions"),
  ]);
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/candidates", candidatesRouter);
  app.use("/api/v1/recruiters", recruitersRouter);
  app.use("/api/v1/institutions", institutionsRouter);
  const createdEmails: string[] = [];
  let server: ReturnType<typeof app.listen> | undefined;
  let address = "";
  let sourceIp = "10.0.0.1";

  async function call(path: string, method = "GET", body?: unknown, cookie = "") {
    const headers: Record<string, string> = { "x-forwarded-for": sourceIp };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${address}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    let data: Record<string, unknown> = {};
    try { data = await response.json() as Record<string, unknown>; } catch { /* Response may be empty. */ }
    return { status: response.status, data, cookie: setCookie ? setCookie.split(";")[0] : cookie };
  }

  const identity = (label: string) => {
    const suffix = crypto.randomUUID();
    const email = `registration-${label}-${suffix}@example.com`;
    createdEmails.push(email);
    return { email, phone: `+919${String(crypto.randomInt(0, 1_000_000_000)).padStart(9, "0")}` };
  };

  async function assertDuplicateRejection(path: string, body: Record<string, unknown>, original: { email: string; phone: string }, label: string) {
    let result = await call(path, "POST", { ...body, email: original.email, phone: identity(`${label}-email-duplicate`).phone });
    assert.equal(result.status, 409, `${label}: duplicate email is rejected`);
    result = await call(path, "POST", { ...body, email: identity(`${label}-phone-duplicate`).email, phone: original.phone });
    assert.equal(result.status, 409, `${label}: duplicate mobile is rejected`);
  }

  async function assertLogin(role: string, email: string, password: string, wrongRole: string) {
    const mismatch = await call("/api/v1/auth/login", "POST", { email, password, expectedRole: wrongRole });
    assert.equal(mismatch.status, 401, `${role}: role-specific login rejects other account types`);
    const signedIn = await call("/api/v1/auth/login", "POST", { email, password, expectedRole: role });
    assert.equal(signedIn.status, 200, `${role}: valid credentials sign in`);
    assert.equal(signedIn.data.role, role);
    assert.ok(signedIn.cookie, `${role}: login sets a session cookie`);
    return signedIn.cookie;
  }

  try {
    const expectedHost = process.env.REGISTRATION_TEST_BRANCH_HOST!;
    assert.equal(new URL(process.env.DATABASE_URL!).hostname, expectedHost, "integration tests must target the explicitly named staging branch host");
    assert.equal(new URL(process.env.DATABASE_URL_UNPOOLED!).hostname, expectedHost.replace("-pooler", ""), "direct connection must target the same staging branch");
    await prisma.$connect();
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    sourceIp = "10.0.0.1";
    const candidate = identity("candidate");
    const candidateBody = { ...candidate, fullName: "Integration Candidate", password: "CandidatePass123!", acceptTerms: true };
    let result = await call("/api/v1/auth/register/candidate", "POST", candidateBody);
    assert.equal(result.status, 201);
    let cookie = result.cookie;
    assert.ok(cookie, "candidate registration starts an authenticated session");
    const retiredOtpRoute = await call("/api/v1/auth/otp/verify", "POST", { code: "123456" });
    assert.equal(retiredOtpRoute.status, 404, "OTP verification is no longer an authentication route");
    await assertDuplicateRejection("/api/v1/auth/register/candidate", candidateBody, candidate, "candidate");
    const candidateIncomplete = identity("candidate-incomplete");
    result = await call("/api/v1/auth/register/candidate", "POST", { ...candidateIncomplete, password: "CandidatePass123!", acceptTerms: true });
    assert.equal(result.status, 400);
    assert.equal(await prisma.user.count({ where: { email: candidateIncomplete.email } }), 0);
    const draftResponse = await call("/api/v1/auth/registration/draft", "PUT", { draft: { headline: "Product engineer" } }, cookie);
    assert.equal(draftResponse.status, 200);
    const registration = await call("/api/v1/auth/registration/status", "GET", undefined, cookie);
    assert.equal(registration.status, 200);
    assert.equal(registration.data.status, "PROFILE_INCOMPLETE");
    assert.equal((registration.data.draft as { headline: string }).headline, "Product engineer");
    result = await call("/api/v1/candidates/me", "PUT", {
      complete: true, headline: "Product engineer", city: "Pune", skills: ["TypeScript", "PostgreSQL"],
      education: [
        { institution: "North College", degree: "B.Tech", field: "Computing", passingYear: 2020, grade: "82%" },
        { institution: "West College", degree: "Diploma", field: "Software", passingYear: 2018 },
      ],
      workExperience: [
        { company: "Example One", title: "Engineer", startDate: "2021-01-01", current: true },
        { company: "Example Two", title: "Intern", startDate: "2020-01-01", endDate: "2020-12-01", current: false },
      ],
      certifications: [
        { name: "Cloud Basics", issuer: "Example", issueDate: "2023-01-01", expiryDate: "2026-01-01" },
        { name: "Web Security", issuer: "Example" },
      ],
    }, cookie);
    assert.equal(result.status, 200);
    let profile = await call("/api/v1/candidates/me", "GET", undefined, cookie);
    assert.equal(profile.status, 200);
    assert.equal((profile.data.candidate as { education: unknown[] }).education.length, 2);
    assert.equal((profile.data.candidate as { workExperience: unknown[] }).workExperience.length, 2);
    assert.equal((profile.data.candidate as { certifications: unknown[] }).certifications.length, 2);
    assert.equal((profile.data.candidate as { user: { registrationStatus: string } }).user.registrationStatus, "REGISTRATION_COMPLETED");
    const savedCandidate = await prisma.user.findUniqueOrThrow({
      where: { email: candidate.email },
      include: { candidate: { include: { education: true, workExperience: true, certifications: true, skills: true } } },
    });
    assert.equal(savedCandidate.role, "CANDIDATE");
    assert.equal(savedCandidate.phoneVerifiedAt, null);
    assert.equal(savedCandidate.emailVerifiedAt, null);
    assert.equal(savedCandidate.candidate?.education.length, 2);
    assert.equal(savedCandidate.candidate?.workExperience.length, 2);
    assert.equal(savedCandidate.candidate?.certifications.length, 2);
    cookie = await assertLogin("CANDIDATE", candidate.email, candidateBody.password, "RECRUITER");
    const candidateDashboard = await call("/api/v1/candidates/me", "GET", undefined, cookie);
    assert.equal(candidateDashboard.status, 200, "candidate session can access its profile dashboard API");

    sourceIp = "10.0.0.2";
    const recruiter = identity("recruiter");
    const recruiterBody = { ...recruiter, fullName: "Integration Recruiter", password: "RecruiterPass123!", recruiterType: "CORPORATE", companyName: "Example Systems", acceptTerms: true };
    result = await call("/api/v1/recruiters/register", "POST", recruiterBody);
    assert.equal(result.status, 201);
    cookie = result.cookie;
    assert.ok(cookie, "recruiter registration starts an authenticated session");
    await assertDuplicateRejection("/api/v1/recruiters/register", recruiterBody, recruiter, "recruiter");
    const recruiterIncomplete = identity("recruiter-incomplete");
    result = await call("/api/v1/recruiters/register", "POST", { ...recruiterIncomplete, fullName: "Incomplete Recruiter", password: "RecruiterPass123!", recruiterType: "CORPORATE", acceptTerms: true });
    assert.equal(result.status, 400);
    assert.equal(await prisma.user.count({ where: { email: recruiterIncomplete.email } }), 0);
    result = await call("/api/v1/auth/registration/draft", "PUT", { draft: { recruiterDesignation: "Talent Lead" } }, cookie);
    assert.equal(result.status, 200);
    result = await call("/api/v1/recruiters/me", "PATCH", {
      complete: true, fullName: "Integration Recruiter", recruiterDesignation: "Talent Lead",
      name: "Example Systems", industry: "Software", city: "Pune",
      hiringDepartments: ["Engineering", "Sales"], hiringLocations: ["Pune", "Mumbai"],
    }, cookie);
    assert.equal(result.status, 200);
    profile = await call("/api/v1/recruiters/me", "GET", undefined, cookie);
    assert.equal((profile.data.employer as { verified: boolean }).verified, false);
    assert.equal((profile.data.employer as { hiringDepartments: string[] }).hiringDepartments.length, 2);
    assert.equal((profile.data.employer as { user: { registrationStatus: string } }).user.registrationStatus, "REGISTRATION_COMPLETED");
    const savedRecruiter = await prisma.user.findUniqueOrThrow({ where: { email: recruiter.email }, include: { employer: true } });
    assert.equal(savedRecruiter.role, "RECRUITER");
    assert.equal(savedRecruiter.phoneVerifiedAt, null);
    assert.equal(savedRecruiter.emailVerifiedAt, null);
    assert.equal(savedRecruiter.employer?.verified, false);
    assert.equal(savedRecruiter.employer?.hiringDepartments.length, 2);
    cookie = await assertLogin("RECRUITER", recruiter.email, recruiterBody.password, "INSTITUTION");
    const recruiterDashboard = await call("/api/v1/recruiters/me", "GET", undefined, cookie);
    assert.equal(recruiterDashboard.status, 200, "recruiter session can access its profile dashboard API");

    sourceIp = "10.0.0.3";
    const institution = identity("institution");
    const institutionBody = { ...institution, contactName: "Integration Contact", password: "InstitutionPass123!", name: "Integration Institute", acceptTerms: true };
    result = await call("/api/v1/institutions/register", "POST", institutionBody);
    assert.equal(result.status, 201);
    cookie = result.cookie;
    assert.ok(cookie, "institution registration starts an authenticated session");
    await assertDuplicateRejection("/api/v1/institutions/register", institutionBody, institution, "institution");
    const institutionIncomplete = identity("institution-incomplete");
    result = await call("/api/v1/institutions/register", "POST", { ...institutionIncomplete, contactName: "Incomplete Contact", password: "InstitutionPass123!", name: "Incomplete Institute" });
    assert.equal(result.status, 400);
    assert.equal(await prisma.user.count({ where: { email: institutionIncomplete.email } }), 0);
    result = await call("/api/v1/institutions/me", "PATCH", {
      complete: true, name: "Integration Institute", institutionType: "University", city: "Pune", state: "Maharashtra",
      departments: ["Engineering", "Business"], courses: ["B.Tech", "MBA"], passingYears: [2025, 2026],
    }, cookie);
    assert.equal(result.status, 200);
    profile = await call("/api/v1/institutions/me", "GET", undefined, cookie);
    const savedInstitution = profile.data.institution as { departments: unknown[]; courses: unknown[]; verified: boolean; user: { registrationStatus: string } };
    assert.equal(savedInstitution.departments.length, 2);
    assert.equal(savedInstitution.courses.length, 2);
    assert.equal(savedInstitution.verified, false);
    assert.equal(savedInstitution.user.registrationStatus, "REGISTRATION_COMPLETED");
    const savedInstitutionUser = await prisma.user.findUniqueOrThrow({
      where: { email: institution.email },
      include: { institution: { include: { departments: true, courses: true } } },
    });
    assert.equal(savedInstitutionUser.role, "INSTITUTION");
    assert.equal(savedInstitutionUser.phoneVerifiedAt, null);
    assert.equal(savedInstitutionUser.emailVerifiedAt, null);
    assert.equal(savedInstitutionUser.institution?.verified, false);
    assert.equal(savedInstitutionUser.institution?.departments.length, 2);
    assert.equal(savedInstitutionUser.institution?.courses.length, 2);
    cookie = await assertLogin("INSTITUTION", institution.email, institutionBody.password, "CANDIDATE");
    const institutionDashboard = await call("/api/v1/institutions/me", "GET", undefined, cookie);
    assert.equal(institutionDashboard.status, 200, "institution session can access its profile dashboard API");

    console.log("Neon integration passed: three role flows without OTP, validation, duplicate handling, drafts, repeated records, and dashboard persistence.");
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (createdEmails.length) await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.$disconnect();
  }
});
