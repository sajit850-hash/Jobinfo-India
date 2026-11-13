import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { settlePayment, taxFor } from "../billing/settlement";
import { prisma, Prisma } from "@jobinfo/database";
import { requireAuth, userOf } from "../auth";
import { scoreJobForCandidate } from "../recommendations/job-match";
import { getJobPostingPolicy } from "../platform/job-posting-policy";

export const jobsRouter = Router();

const makeReference = () => `JI-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const slugify = (title: string, reference: string) => `${title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${reference.toLowerCase()}`;

jobsRouter.get("/drafts", requireAuth("RECRUITER"), async (req, res) => {
  const data = await prisma.recruiterJobDraft.findMany({ where: { ownerId: userOf(req).id }, orderBy: { updatedAt: "desc" }, include: { job: { select: { id: true, title: true, jobReference: true, status: true } } } });
  res.json({ data });
});

jobsRouter.post("/drafts", requireAuth("RECRUITER"), async (req, res) => {
  const p = z.object({ data: z.record(z.string(), z.unknown()).default({}), currentStep: z.number().int().min(1).max(12).default(1) }).safeParse(req.body || {});
  if (!p.success) return res.status(400).json({ error: "Invalid draft" });
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  if (!employer) return res.status(404).json({ error: "Recruiter company profile not found" });
  const draft = await prisma.job.create({ data: {
    employerId: employer.id, title: "Untitled job", description: "Draft job description", location: "India", status: "DRAFT", jobReference: makeReference(),
    draft: { create: { ownerId: userOf(req).id, currentStep: p.data.currentStep, data: p.data.data as Prisma.InputJsonValue } },
    statusHistory: { create: { newStatus: "DRAFT", changedById: userOf(req).id, reason: "Draft created" } },
  }, include: { draft: true } });
  res.status(201).json({ draft: draft.draft, jobId: draft.id, jobReference: draft.jobReference });
});

jobsRouter.get("/drafts/:id", requireAuth("RECRUITER"), async (req, res) => {
  const draft = await prisma.recruiterJobDraft.findFirst({ where: { jobId: String(req.params.id), ownerId: userOf(req).id }, include: { job: { select: { id: true, jobReference: true, status: true } } } });
  if (!draft) return res.status(404).json({ error: "Draft not found" });
  res.json({ draft });
});

jobsRouter.patch("/drafts/:id", requireAuth("RECRUITER"), async (req, res) => {
  const p = z.object({ data: z.record(z.string(), z.unknown()), currentStep: z.number().int().min(1).max(12), expectedVersion: z.number().int().positive().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid draft data" });
  const prior = await prisma.recruiterJobDraft.findFirst({ where: { jobId: String(req.params.id), ownerId: userOf(req).id } });
  if (!prior) return res.status(404).json({ error: "Draft not found" });
  if (p.data.expectedVersion != null && p.data.expectedVersion !== prior.version) return res.status(409).json({ error: "This draft changed in another session. Reload it before saving." });
  const draft = await prisma.$transaction(async (tx) => {
    const updated = await tx.recruiterJobDraft.update({ where: { id: prior.id }, data: { data: p.data.data as Prisma.InputJsonValue, currentStep: p.data.currentStep, version: { increment: 1 } } });
    await tx.job.update({ where: { id: prior.jobId }, data: { updatedAt: new Date() } });
    return updated;
  });
  res.json({ draft });
});

const postingSchema = z.object({
  basic: z.object({ title:z.string().trim().min(3).max(150), companyName:z.string().trim().min(2).max(150), department:z.string().trim().min(2).max(100), category:z.string().trim().min(2).max(100), jobFunction:z.string().trim().max(100).optional(), employmentType:z.string().min(1).default("FULL_TIME"), experienceLevel:z.string().min(1).default("MID_LEVEL"), experienceMin:z.number().int().min(0).max(50).default(0), experienceMax:z.number().int().min(0).max(50).default(50), openings:z.number().int().min(1).max(100000).default(1) }).refine(x => x.experienceMax >= x.experienceMin, { message:"Maximum experience must be at least the minimum" }),
  workplace: z.object({ workplaceType:z.enum(["ON_SITE","REMOTE","HYBRID"]), country:z.string().trim().min(2).max(80), state:z.string().trim().max(80).optional(), city:z.string().trim().max(100).optional(), officeAddress:z.string().trim().max(300).optional(), remoteEligibility:z.string().max(200).optional(), relocationAssistance:z.boolean().default(false), travelRequirement:z.string().max(200).optional() }).superRefine((x,ctx)=>{ if(x.workplaceType!=="REMOTE"&&(!x.city||!x.state))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Add a city and state for on-site or hybrid work",path:["city"]}); if(x.workplaceType==="REMOTE"&&!x.remoteEligibility)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Choose where remote candidates may work",path:["remoteEligibility"]}); }),
  description:z.object({ aboutCompany:z.string().max(5000).optional(), overview:z.string().trim().min(20).max(10000), responsibilities:z.string().max(15000).default(""), requiredQualifications:z.string().max(10000).default(""), preferredQualifications:z.string().max(10000).optional(), technicalRequirements:z.string().max(10000).optional(), benefitsAndPerks:z.string().max(10000).optional(), equalOpportunityStatement:z.string().max(3000).optional() }),
  skills:z.object({ required:z.array(z.string().trim().min(1).max(80)).max(50).default([]), preferred:z.array(z.string().trim().min(1).max(80)).max(50).default([]), technical:z.array(z.string().trim().min(1).max(80)).max(50).default([]), soft:z.array(z.string().trim().min(1).max(80)).max(50).default([]), education:z.array(z.object({name:z.string().trim().min(1).max(150),minimum:z.string().max(100).optional(),preferred:z.boolean().default(false)})).max(20).default([]), certifications:z.array(z.string().trim().min(1).max(150)).max(30).default([]), languages:z.array(z.string().trim().min(1).max(80)).max(30).default([]), specialization:z.string().max(150).optional() }),
  compensation:z.object({ minimum:z.number().int().min(0).nullable(), maximum:z.number().int().min(0).nullable(), currency:z.string().length(3).default("INR"), period:z.enum(["HOURLY","DAILY","MONTHLY","ANNUAL"]), disclose:z.boolean(), incentives:z.string().max(2000).optional(), bonus:z.string().max(2000).optional(), benefits:z.array(z.string().max(100)).max(30), otherBenefits:z.string().max(1000).optional() }).refine(x=>x.minimum==null||x.maximum==null||x.maximum>=x.minimum,{message:"Minimum salary cannot exceed maximum salary"}),
  application:z.object({ method:z.enum(["INTERNAL","EXTERNAL","COMPANY_SITE"]), externalUrl:z.string().url().optional().or(z.literal("")), deadline:z.string().optional(), resumeRequired:z.boolean(), coverLetterRequired:z.boolean(), allowUpdates:z.boolean(), collectAdditionalInformation:z.boolean(), confirmationEmail:z.boolean(), maxApplications:z.number().int().positive().max(100000).nullable() }).superRefine((x,ctx)=>{if(x.method!=="INTERNAL"&&!x.externalUrl)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Add the external application URL",path:["externalUrl"]});}),
  screening:z.array(z.object({prompt:z.string().trim().min(5).max(500),type:z.enum(["YES_NO","SINGLE_CHOICE","MULTIPLE_CHOICE","NUMBER","TEXT","DATE","EXPERIENCE","LOCATION","CERTIFICATION"]),required:z.boolean(),mustHave:z.boolean(),knockout:z.boolean(),rejectionMessage:z.string().max(500).optional(),options:z.array(z.string().trim().min(1).max(150)).max(30),active:z.boolean()})).max(30),
  team:z.object({ members:z.array(z.object({email:z.string().email(),permissions:z.array(z.enum(["VIEW_JOB","EDIT_JOB","VIEW_APPLICANTS","DOWNLOAD_RESUMES","SHORTLIST_CANDIDATES","REJECT_CANDIDATES","MANAGE_APPLICATIONS"]))})).max(20) }),
  preferences:z.object({ urgent:z.boolean(),immediateJoining:z.boolean(),backgroundVerification:z.boolean(),workAuthorization:z.string().max(500).optional(),interviewRounds:z.number().int().min(1).max(20).nullable(),expectedJoiningDate:z.string().optional(),visibility:z.enum(["PUBLIC","UNLISTED"]) }),
  planCode:z.string().min(2).max(50).default("FREE_JOB"),
}).passthrough();

jobsRouter.get("/posting-plans", requireAuth("RECRUITER"), async (_req,res)=>{
  const data=await prisma.jobPostingPlan.findMany({where:{active:true},orderBy:{pricePaise:"asc"}});
  res.json({data});
});

jobsRouter.get("/posting-policy", requireAuth("RECRUITER"), async (req,res)=>{
  const [policy, employer] = await Promise.all([
    getJobPostingPolicy(),
    prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true, verified: true } }),
  ]);
  if (!employer) return res.status(404).json({ error: "Recruiter company profile not found" });
  const activeFreeJobs = await prisma.job.count({ where: { employerId: employer.id, postingPlanCode: "FREE_JOB", status: { in: ["PENDING_APPROVAL","PENDING_REVIEW","PUBLISHED","ACTIVE","PAUSED"] } } });
  const reasons = [
    ...(!policy.enabled ? ["Job posting is currently disabled by the platform administrator"] : []),
    ...(!policy.freePostingEnabled ? ["Free job posting is currently disabled by the platform administrator"] : []),
    ...(policy.requireVerifiedRecruiter && !employer.verified ? ["Your company must be verified before posting"] : []),
    ...(policy.maxActiveFreeJobs > 0 && activeFreeJobs >= policy.maxActiveFreeJobs ? [`You have reached the limit of ${policy.maxActiveFreeJobs} active free jobs`] : []),
  ];
  res.json({ policy, eligible: reasons.length === 0, reasons, activeFreeJobs });
});

jobsRouter.get("/:id/posting-entitlement", requireAuth("RECRUITER"), async (req, res) => {
  const draft = await prisma.recruiterJobDraft.findFirst({ where: { jobId: String(req.params.id), ownerId: userOf(req).id } });
  if (!draft) return res.status(404).json({ error: "Draft not found" });
  const planCode = (draft.data as Record<string, any>).planCode;
  if (!planCode) return res.json({ authorized: false });
  const plan = await prisma.jobPostingPlan.findUnique({ where: { code: planCode } });
  if (!plan) return res.json({ authorized: false });
  const entitlement = await prisma.jobPostingTransaction.findFirst({ where: { jobId: draft.jobId, userId: userOf(req).id, planId: plan.id, status: { in: ["AUTHORIZED", "PAID"] }, OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] }, select: { id: true } });
  res.json({ authorized: Boolean(entitlement) });
});

jobsRouter.post("/:id/checkout", requireAuth("RECRUITER"), async (req,res)=>{
  const p=z.object({planCode:z.string().min(2),returnUrl:z.string().url().optional()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"Select a valid posting plan"});
  const draft=await prisma.recruiterJobDraft.findFirst({where:{jobId:String(req.params.id),ownerId:userOf(req).id},include:{job:true}});
  if(!draft||draft.job.status!=="DRAFT")return res.status(404).json({error:"Draft not found"});
  if(p.data.planCode==="FREE_JOB"){
    const policy=await getJobPostingPolicy();
    if(!policy.enabled||!policy.freePostingEnabled)return res.status(403).json({error:"Free job posting is currently disabled by the platform administrator"});
    const current=draft.data as Record<string,unknown>;
    await prisma.recruiterJobDraft.update({where:{id:draft.id},data:{data:{...current,planCode:"FREE_JOB"} as Prisma.InputJsonValue,version:{increment:1}}});
    return res.status(200).json({mode:"free",authorized:true});
  }
  const plan=await prisma.jobPostingPlan.findUnique({where:{code:p.data.planCode}});
  if(!plan||!plan.active)return res.status(404).json({error:"Posting plan is unavailable"});
  if(plan.pricePaise===0){
    const since=new Date(Date.now()-30*86400000);
    const used=await prisma.jobPostingTransaction.count({where:{userId:userOf(req).id,planId:plan.id,status:{in:["AUTHORIZED","PAID"]},createdAt:{gte:since}}});
    if(used>=plan.postingCredits)return res.status(409).json({error:"Your free posting credit has been used. Choose a paid plan."});
    const tx=await prisma.jobPostingTransaction.create({data:{userId:userOf(req).id,jobId:draft.jobId,planId:plan.id,amountPaise:0,provider:"free",status:"AUTHORIZED",creditsGranted:1,validUntil:new Date(Date.now()+plan.durationDays*86400000)}});
    const value=(draft.data as Record<string,unknown>); await prisma.recruiterJobDraft.update({where:{id:draft.id},data:{data:{...value,planCode:plan.code} as Prisma.InputJsonValue,version:{increment:1}}});
    return res.status(201).json({transactionId:tx.id,mode:"free",authorized:true});
  }
  if(!await prisma.billingProfile.findUnique({where:{userId:userOf(req).id}}))return res.status(409).json({error:"Add billing details in Plans and billing before paid checkout"});
  const charge=taxFor(plan.pricePaise);
  const transaction=await prisma.jobPostingTransaction.create({data:{userId:userOf(req).id,jobId:draft.jobId,planId:plan.id,amountPaise:charge.totalPaise,taxPaise:charge.taxPaise,currency:"INR",provider:process.env.PAYMENT_PROVIDER||"unconfigured"}});
  try{
    const provider=(await import("../integrations/registry")).getPaymentProvider();
    const session=await provider.createCheckout({transactionId:transaction.id,amountPaise:charge.totalPaise,currency:"INR",description:`Jobinfo India job posting: ${plan.name}`,returnUrl:p.data.returnUrl||"http://localhost:3000/recruiter/jobs/create"});
    await prisma.jobPostingTransaction.update({where:{id:transaction.id},data:{provider:session.provider,providerRef:session.providerReference}});
    return res.status(201).json({transactionId:transaction.id,checkoutUrl:session.checkoutUrl,mode:session.mode,subtotalPaise:plan.pricePaise,gstPaise:charge.taxPaise,totalPaise:charge.totalPaise});
  }catch(error){await prisma.jobPostingTransaction.update({where:{id:transaction.id},data:{status:"PROVIDER_NOT_CONFIGURED"}});return res.status(503).json({error:error instanceof Error?error.message:"Payment provider unavailable"});}
});

if(process.env.NODE_ENV!=="production")jobsRouter.post("/:id/payment/dev-confirm/:transactionId",requireAuth("RECRUITER"),async(req,res)=>{
  const tx=await prisma.jobPostingTransaction.findFirst({where:{id:String(req.params.transactionId),jobId:String(req.params.id),userId:userOf(req).id,status:"PENDING",provider:"mock"},include:{plan:true}});
  if(!tx)return res.status(404).json({error:"Development posting transaction not found"});
  try { await settlePayment({ transactionId: tx.id, providerReference: tx.providerRef || `test_${tx.id}`, status: "PAID" }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "Could not confirm test payment" }); }
  res.json({ok:true,mode:"test",message:"Test checkout confirmed. No real money was charged."});
});

jobsRouter.post("/:id/submit-approval",requireAuth("RECRUITER"),async(req,res)=>{
  const draft=await prisma.recruiterJobDraft.findFirst({where:{jobId:String(req.params.id),ownerId:userOf(req).id},include:{job:true}});
  if(!draft||draft.job.status!=="DRAFT")return res.status(404).json({error:"Draft not found"});
  const savedData=draft.data as Record<string,unknown>;
  const parsed=postingSchema.safeParse({...savedData,planCode:typeof savedData.planCode==="string"&&savedData.planCode?savedData.planCode:"FREE_JOB"});
  if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0].message,issues:parsed.error.issues.map(x=>({path:x.path,message:x.message}))});
  const data=parsed.data;
  const policy=await getJobPostingPolicy();
  if(!policy.enabled)return res.status(403).json({error:"Job posting is currently disabled by the platform administrator"});
  const employer=await prisma.employer.findUnique({where:{userId:userOf(req).id}});
  if(!employer)return res.status(404).json({error:"Company profile not found"});
  if(employer.name.trim().toLowerCase()!==data.basic.companyName.trim().toLowerCase())return res.status(400).json({error:"Company name must match your recruiter company profile"});
  if(policy.requireVerifiedRecruiter&&!employer.verified)return res.status(403).json({error:"Your company must be verified before posting"});
  if(data.basic.openings>policy.maxOpenings)return res.status(400).json({error:`A job post can have at most ${policy.maxOpenings} openings`});
  const isFree=data.planCode==="FREE_JOB";
  if(isFree&&!policy.freePostingEnabled)return res.status(403).json({error:"Free job posting is currently disabled by the platform administrator"});
  const plan=isFree?null:await prisma.jobPostingPlan.findUnique({where:{code:data.planCode}});
  if(!isFree&&(!plan||!plan.active))return res.status(400).json({error:"Choose an active posting plan"});
  if(plan){
    const entitlement=await prisma.jobPostingTransaction.findFirst({where:{jobId:draft.jobId,userId:userOf(req).id,planId:plan.id,status:{in:["AUTHORIZED","PAID"]},OR:[{validUntil:null},{validUntil:{gt:new Date()}}]},orderBy:{createdAt:"desc"}});
    if(!entitlement)return res.status(402).json({error:"Complete posting plan checkout before submitting this job"});
  }
  if(isFree&&policy.maxActiveFreeJobs>0){
    const activeFreeJobs=await prisma.job.count({where:{employerId:employer.id,postingPlanCode:"FREE_JOB",status:{in:["PENDING_APPROVAL","PENDING_REVIEW","PUBLISHED","ACTIVE","PAUSED"]}}});
    if(activeFreeJobs>=policy.maxActiveFreeJobs)return res.status(403).json({error:`You have reached the limit of ${policy.maxActiveFreeJobs} active free jobs`});
  }
  const activeSubscription=await prisma.subscription.findFirst({where:{userId:userOf(req).id,status:"ACTIVE",endsAt:{gt:new Date()}},orderBy:{endsAt:"desc"},select:{limits:true}});
  const limits=(activeSubscription?.limits||{}) as Record<string,unknown>;
  if(!isFree&&typeof limits.activeJobs==="number"){
    const activeJobs=await prisma.job.count({where:{employerId:employer.id,status:{in:["PENDING_APPROVAL","PENDING_REVIEW","PUBLISHED","ACTIVE","PAUSED"]}}});
    if(activeJobs>=limits.activeJobs)return res.status(403).json({error:`Your active subscription allows ${limits.activeJobs} active jobs. Upgrade or close an active job to continue.`});
  }
  if(!isFree&&typeof limits.jobPostsPerMonth==="number"){
    const monthStart=new Date();monthStart.setDate(1);monthStart.setHours(0,0,0,0);
    const postsThisMonth=await prisma.jobPostingTransaction.count({where:{userId:userOf(req).id,status:{in:["AUTHORIZED","PAID"]},createdAt:{gte:monthStart}}});
    if(postsThisMonth>=limits.jobPostsPerMonth)return res.status(403).json({error:`Your subscription's monthly job post limit is ${limits.jobPostsPerMonth}.`});
  }
  const location=[data.workplace.city,data.workplace.state,data.workplace.country].filter(Boolean).join(", ");
  const description=Object.entries({"About the Company":data.description.aboutCompany,"Job Overview":data.description.overview,"Key Responsibilities":data.description.responsibilities,"Required Qualifications":data.description.requiredQualifications,"Preferred Qualifications":data.description.preferredQualifications,"Technical Requirements":data.description.technicalRequirements,"Benefits and Perks":data.description.benefitsAndPerks,"Equal Opportunity":data.description.equalOpportunityStatement}).filter(([,v])=>v).map(([heading,value])=>`${heading}\n${value}`).join("\n\n");
  const requiredSkills=[...new Set(data.skills.required.map(x=>x.trim()))];
  const skills=[...requiredSkills.map(name=>({name,kind:"REQUIRED"})),...data.skills.preferred.map(name=>({name,kind:"PREFERRED"})),...data.skills.technical.map(name=>({name,kind:"TECHNICAL"})),...data.skills.soft.map(name=>({name,kind:"SOFT"}))];
  const requirements=[...data.skills.education.map(x=>({kind:"EDUCATION",name:x.name,minimum:x.minimum||null,preferred:x.preferred})),...data.skills.certifications.map(name=>({kind:"CERTIFICATION",name,minimum:null,preferred:false})),...data.skills.languages.map(name=>({kind:"LANGUAGE",name,minimum:null,preferred:false}))];
  const expectedJoiningDate=data.preferences.expectedJoiningDate?.trim()?new Date(data.preferences.expectedJoiningDate):null;
  const deadline=data.application.deadline?.trim()?new Date(data.application.deadline):null;
  if(deadline&&deadline<new Date())return res.status(400).json({error:"Application deadline must be in the future"});
  const result=await prisma.$transaction(async(tx)=>{
    const job=await tx.job.update({where:{id:draft.jobId},data:{
      title:data.basic.title,description,location,category:data.basic.category,employmentType:data.basic.employmentType,experienceMin:data.basic.experienceMin,experienceMax:data.basic.experienceMax,
      department:data.basic.department,jobFunction:data.basic.jobFunction,experienceLevel:data.basic.experienceLevel,openings:data.basic.openings,
      workplaceType:data.workplace.workplaceType,country:data.workplace.country,state:data.workplace.state||null,city:data.workplace.city||null,officeAddress:data.workplace.officeAddress||null,remoteEligibility:data.workplace.remoteEligibility||null,relocationAssistance:data.workplace.relocationAssistance,travelRequirement:data.workplace.travelRequirement||null,
      aboutCompany:data.description.aboutCompany||null,jobOverview:data.description.overview,responsibilities:data.description.responsibilities,requiredQualifications:data.description.requiredQualifications,preferredQualifications:data.description.preferredQualifications||null,technicalRequirements:data.description.technicalRequirements||null,benefitsAndPerks:data.description.benefitsAndPerks||null,equalOpportunityStatement:data.description.equalOpportunityStatement||null,
      salaryMin:data.compensation.disclose?data.compensation.minimum:null,salaryMax:data.compensation.disclose?data.compensation.maximum:null,salaryCurrency:data.compensation.currency,salaryPeriod:data.compensation.period,salaryDisclosure:data.compensation.disclose,incentives:data.compensation.incentives||null,bonus:data.compensation.bonus||null,
      applicationMethod:data.application.method,externalApplyUrl:data.application.externalUrl||null,applicationDeadline:deadline,resumeRequired:data.application.resumeRequired,coverLetterRequired:data.application.coverLetterRequired,allowApplicationUpdates:data.application.allowUpdates,collectAdditionalInformation:data.application.collectAdditionalInformation,confirmationEmail:data.application.confirmationEmail,maxApplications:data.application.maxApplications,
      urgentHiring:data.preferences.urgent,immediateJoining:data.preferences.immediateJoining,backgroundVerification:data.preferences.backgroundVerification,workAuthorization:data.preferences.workAuthorization||null,interviewRounds:data.preferences.interviewRounds,expectedJoiningDate,visibility:data.preferences.visibility,postingPlanCode:data.planCode,status:policy.requireApproval?"PENDING_APPROVAL":"PUBLISHED",...(policy.requireApproval?{}:{publishedAt:new Date(),expiresAt:new Date(Date.now()+policy.expiryDays*86400000)}),
      jobReference:draft.job.jobReference||makeReference(),
    }});
    await tx.jobSkill.deleteMany({where:{jobId:job.id}});if(skills.length)await tx.jobSkill.createMany({data:skills.map(x=>({...x,jobId:job.id}))});
    await tx.jobRequirement.deleteMany({where:{jobId:job.id}});if(requirements.length)await tx.jobRequirement.createMany({data:requirements.map(x=>({...x,jobId:job.id}))});
    const benefits=[...data.compensation.benefits,...(data.compensation.otherBenefits?[data.compensation.otherBenefits]:[])];await tx.jobBenefit.deleteMany({where:{jobId:job.id}});if(benefits.length)await tx.jobBenefit.createMany({data:[...new Set(benefits)].map(name=>({jobId:job.id,name}))});
    await tx.jobApplicationSetting.upsert({where:{jobId:job.id},create:{jobId:job.id,method:data.application.method,externalUrl:data.application.externalUrl||null,resumeRequired:data.application.resumeRequired,coverLetterRequired:data.application.coverLetterRequired,allowUpdates:data.application.allowUpdates,collectAdditionalInformation:data.application.collectAdditionalInformation,confirmationEmail:data.application.confirmationEmail,maxApplications:data.application.maxApplications},update:{method:data.application.method,externalUrl:data.application.externalUrl||null,resumeRequired:data.application.resumeRequired,coverLetterRequired:data.application.coverLetterRequired,allowUpdates:data.application.allowUpdates,collectAdditionalInformation:data.application.collectAdditionalInformation,confirmationEmail:data.application.confirmationEmail,maxApplications:data.application.maxApplications}});
    await tx.jobScreeningQuestion.deleteMany({where:{jobId:job.id}});
    for(const [index,q] of data.screening.entries())await tx.jobScreeningQuestion.create({data:{jobId:job.id,prompt:q.prompt,type:q.type,required:q.required,mustHave:q.mustHave,knockout:q.knockout,rejectionMessage:q.rejectionMessage||null,displayOrder:index,active:q.active,options:{create:q.options.map(label=>({label,value:label}))}}});
    const teamEmails = [...new Set(data.team.members.map((member) => member.email.trim().toLowerCase()))];
    if (teamEmails.length) {
      const teammates = await tx.user.findMany({ where: { email: { in: teamEmails }, role: "RECRUITER", isActive: true }, select: { id: true, email: true } });
      if (teammates.length) await tx.jobTeamMember.createMany({ data: teammates.map((member) => ({ jobId: job.id, userId: member.id, permissions: data.team.members.find((x) => x.email.trim().toLowerCase() === member.email)?.permissions || ["VIEW_JOB"] })), skipDuplicates: true });
    }
    const nextStatus=policy.requireApproval?"PENDING_APPROVAL":"PUBLISHED";
    await tx.jobStatusHistory.create({data:{jobId:job.id,previousStatus:"DRAFT",newStatus:nextStatus,changedById:userOf(req).id,reason:policy.requireApproval?"Submitted for moderation":"Published under platform job posting policy"}});
    await tx.auditLog.create({data:{actorId:userOf(req).id,action:policy.requireApproval?"JOB_SUBMITTED_FOR_APPROVAL":"JOB_PUBLISHED_BY_POLICY",entityType:"Job",entityId:job.id,metadata:{jobReference:job.jobReference,planCode:data.planCode}}});
    return job;
  });
  res.status(202).json({job:result,message:policy.requireApproval?"Job submitted for approval.":"Job published."});
});

const query = z.object({
  q: z.string().trim().max(100).optional(),
  location: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  featured: z.enum(["true", "false"]).optional(),
  employmentType: z.string().trim().max(50).optional(),
  workplaceType: z.enum(["ON_SITE", "REMOTE", "HYBRID"]).optional(),
  experienceMin: z.coerce.number().int().min(0).max(50).optional(),
  experienceMax: z.coerce.number().int().min(0).max(50).optional(),
  salaryMin: z.coerce.number().int().min(0).optional(),
  salaryMax: z.coerce.number().int().min(0).optional(),
  skills: z.string().trim().max(500).optional(),
  sort: z.enum(["relevance","date"]).default("relevance"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

jobsRouter.get("/", async (req, res) => {
  const f = query.safeParse(req.query);
  if (!f.success) return res.status(400).json({ error: "Invalid filters" });
  const { q, location, category, featured, page, limit, employmentType, workplaceType, experienceMin, experienceMax, salaryMin, salaryMax, skills, sort } = f.data;
  const now=new Date();
  const skillNames=skills?.split(",").map(x=>x.trim()).filter(Boolean).slice(0,10)||[];
  const where: Prisma.JobWhereInput = {
    status: "PUBLISHED", visibility:"PUBLIC", AND:[{OR: [{expiresAt:null},{expiresAt:{gt:now}}]}],
    ...(employmentType&&{employmentType}),
    ...(workplaceType&&{workplaceType}),
    ...(experienceMin===0?{experienceMin:0,experienceMax:0}:experienceMin!=null&&{experienceMax:{gte:experienceMin}}),
    ...(experienceMax!=null&&{experienceMin:{lte:experienceMax}}),
    ...(salaryMin!=null&&{salaryMax:{gte:salaryMin}}),
    ...(salaryMax!=null&&{salaryMin:{lte:salaryMax}}),
    ...(skillNames.length&&{skills:{some:{name:{in:skillNames,mode:"insensitive"}}}}),
    ...(category && { category }),
    ...(featured === "true" && { featured: true }),
    ...(location && { location: { contains: location, mode: "insensitive" } }),
    ...(q && {
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { employer: { name: { contains: q, mode: "insensitive" } } },
      ],
    }),
  };
  const [total, rows] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({
      where,
      orderBy: sort==="date" ? [{createdAt:"desc"}] : [{ featured: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: { employer: { select: { name: true, verified: true } }, skills: { select: { name: true, kind: true }, take: 6 } },
    }),
  ]);
  res.json({
    total,
    page,
    data: rows.map((j) => ({
      id: j.id,
      title: j.title,
      company: j.employer.name,
      verified: j.employer.verified,
      location: j.location,
      category: j.category,
      experienceMin: j.experienceMin,
      experienceMax: j.experienceMax,
      salaryMin: j.salaryMin,
      salaryMax: j.salaryMax,
      salaryCurrency: j.salaryCurrency,
      salaryPeriod: j.salaryPeriod,
      featured: j.featured,
      employmentType: j.employmentType,
      workplaceType: j.workplaceType,
      skills: j.skills,
      createdAt: j.createdAt,
    })),
  });
});


jobsRouter.get("/categories", async (_req, res) => {
  const g = await prisma.job.groupBy({ by: ["category"], where: { status: "PUBLISHED", visibility:"PUBLIC", category: { not: null }, AND:[{OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}] }, _count: true });
  res.json({ data: g.map((x) => ({ name: x.category, count: x._count })) });
});

jobsRouter.get("/recommendations", requireAuth("CANDIDATE"), async (req, res) => {
  const candidate = await prisma.candidate.findUnique({
    where: { userId: userOf(req).id },
    select: { id: true, city: true, state: true, experienceYears: true, preferredJobLocations: true, preferredJobRoles: true, skills: { select: { name: true } } },
  });
  if (!candidate) return res.status(404).json({ error: "Candidate profile not found" });
  const now = new Date();
  const jobs = await prisma.job.findMany({
    where: { status: "PUBLISHED", visibility: "PUBLIC", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: [{ featured: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
    take: 500,
    select: {
      id: true, title: true, location: true, category: true, department: true, workplaceType: true,
      experienceMin: true, experienceMax: true, salaryMin: true, salaryMax: true, salaryCurrency: true,
      featured: true, publishedAt: true,
      employer: { select: { name: true, verified: true } },
      skills: { select: { name: true, kind: true } },
      applications: { where: { candidateId: candidate.id }, select: { id: true }, take: 1 },
    },
  });
  const data = jobs.map((job) => ({
    id: job.id, title: job.title, location: job.location, category: job.category, workplaceType: job.workplaceType,
    experienceMin: job.experienceMin, experienceMax: job.experienceMax, salaryMin: job.salaryMin, salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency, featured: job.featured, publishedAt: job.publishedAt,
    company: job.employer.name, verified: job.employer.verified, applied: job.applications.length > 0,
    ...scoreJobForCandidate(candidate, job),
  })).sort((a, b) => b.fitPercent - a.fitPercent || Number(b.featured) - Number(a.featured) || (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0)).slice(0, 12);
  res.json({
    data,
    disclaimer: "Profile fit scores compare the information you provided with job details. They are guidance only and do not predict hiring outcomes.",
  });
});

jobsRouter.get("/mine", requireAuth("RECRUITER"), async (req, res) => {
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  if (!employer) return res.status(404).json({ error: "Recruiter profile not found" });
  const data = await prisma.job.findMany({ where: { employerId: employer.id }, orderBy: { createdAt: "desc" }, include: { _count: { select: { applications: true } } } });
  res.json({ data });
});

const jobUpdateSchema = z.object({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(30).max(20000),
  location: z.string().trim().min(2).max(120),
  category: z.string().trim().max(100).optional(),
  employmentType: z.string().trim().max(50).optional(),
  experienceMin: z.number().int().min(0).max(50).nullable().optional(),
  experienceMax: z.number().int().min(0).max(50).nullable().optional(),
  salaryMin: z.number().int().min(0).nullable().optional(),
  salaryMax: z.number().int().min(0).nullable().optional(),
}).refine((j) => j.experienceMin == null || j.experienceMax == null || j.experienceMax >= j.experienceMin, { message: "Maximum experience must be at least the minimum" })
  .refine((j) => j.salaryMin == null || j.salaryMax == null || j.salaryMax >= j.salaryMin, { message: "Maximum salary must be at least the minimum" });

jobsRouter.patch("/:id", requireAuth("RECRUITER"), async (req, res) => {
  const p = jobUpdateSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  const job = await prisma.job.findFirst({ where: { id: String(req.params.id), employerId: employer?.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status === "CLOSED") return res.status(409).json({ error: "Closed jobs cannot be edited" });
  const policy=await getJobPostingPolicy();
  if(job.status==="PUBLISHED"&&!policy.allowEditsAfterApproval)return res.status(403).json({error:"The platform administrator has disabled edits to published jobs"});
  if(!["DRAFT","PUBLISHED","PAUSED","CHANGES_REQUESTED","REJECTED"].includes(job.status))return res.status(409).json({error:"This job cannot be edited in its current review state"});
  const nextStatus=job.status==="PUBLISHED"?"PENDING_REVIEW":["CHANGES_REQUESTED","REJECTED"].includes(job.status)?"PENDING_APPROVAL":job.status;
  const updated = await prisma.$transaction(async tx=>{
    const row=await tx.job.update({ where: { id: job.id }, data: { ...p.data, status: nextStatus } });
    if(nextStatus!==job.status){await tx.jobStatusHistory.create({data:{jobId:job.id,previousStatus:job.status,newStatus:nextStatus,changedById:userOf(req).id,reason:job.status==="PUBLISHED"?"Recruiter submitted edits for review":"Recruiter resubmitted requested changes"}});}
    return row;
  });
  res.json({ job: updated, message: nextStatus!==job.status ? "Changes submitted for review." : "Job updated." });
});

jobsRouter.patch("/:id/status", requireAuth("RECRUITER"), async (req, res) => {
  const p = z.object({ status: z.enum(["PAUSED", "CLOSED", "PENDING_REVIEW"]) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Choose pause, close or resume this job" });
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  const job = await prisma.job.findFirst({ where: { id: String(req.params.id), employerId: employer?.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status === "CLOSED") return res.status(409).json({ error: "Closed jobs cannot be reopened" });
  if (p.data.status === "PAUSED" && job.status !== "PUBLISHED") return res.status(409).json({ error: "Only published jobs can be paused" });
  if (p.data.status === "PENDING_REVIEW" && job.status !== "PAUSED") return res.status(409).json({ error: "Only paused jobs can be submitted for review again" });
  const policy=await getJobPostingPolicy();
  if(p.data.status==="PENDING_REVIEW"&&!policy.allowRenewals)return res.status(403).json({error:"Job renewals are disabled by the platform administrator"});
  const updated = await prisma.job.update({ where: { id: job.id }, data: { status: p.data.status } });
  res.json({ job: updated });
});

jobsRouter.post("/:id/duplicate", requireAuth("RECRUITER"), async (req, res) => {
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  const source = await prisma.job.findFirst({ where: { id: String(req.params.id), employerId: employer?.id }, include: { skills: true, requirements: true, benefits: true, screeningQuestions: { include: { options: true } }, applicationSetting: true, employer: { select: { name: true } } } });
  if (!source) return res.status(404).json({ error: "Job not found" });
  const job = await prisma.job.create({ data: {
    employerId: source.employerId, title: `${source.title} (copy)`, description: source.description,
    location: source.location, category: source.category, employmentType: source.employmentType,
    experienceMin: source.experienceMin, experienceMax: source.experienceMax, salaryMin: source.salaryMin,
    salaryMax: source.salaryMax, department: source.department, jobFunction: source.jobFunction,
    experienceLevel: source.experienceLevel, openings: source.openings, workplaceType: source.workplaceType,
    country: source.country, state: source.state, city: source.city, officeAddress: source.officeAddress,
    remoteEligibility: source.remoteEligibility, aboutCompany: source.aboutCompany, jobOverview: source.jobOverview,
    responsibilities: source.responsibilities, requiredQualifications: source.requiredQualifications,
    preferredQualifications: source.preferredQualifications, technicalRequirements: source.technicalRequirements,
    benefitsAndPerks: source.benefitsAndPerks, salaryCurrency: source.salaryCurrency, salaryPeriod: source.salaryPeriod,
    salaryDisclosure: source.salaryDisclosure, applicationMethod: source.applicationMethod,
    externalApplyUrl: source.externalApplyUrl, resumeRequired: source.resumeRequired,
    coverLetterRequired: source.coverLetterRequired, status: "DRAFT", jobReference: makeReference(),
    statusHistory: { create: { newStatus: "DRAFT", changedById: userOf(req).id, reason: `Duplicated from ${source.jobReference || source.id}` } },
  } });
  await prisma.recruiterJobDraft.create({ data: { jobId: job.id, ownerId: userOf(req).id, currentStep: 1, data: {
    basic: { title: `${source.title} (copy)`, companyName: source.employer.name, department: source.department || "", category: source.category || "", jobFunction: source.jobFunction || "", employmentType: source.employmentType || "FULL_TIME", experienceLevel: source.experienceLevel || "MID_LEVEL", experienceMin: source.experienceMin ?? 0, experienceMax: source.experienceMax ?? 0, openings: source.openings },
    workplace: { workplaceType: source.workplaceType || "ON_SITE", country: source.country || "India", state: source.state || "", city: source.city || "", officeAddress: source.officeAddress || "", remoteEligibility: source.remoteEligibility || "", relocationAssistance: source.relocationAssistance, travelRequirement: source.travelRequirement || "" },
    description: { aboutCompany: source.aboutCompany || "", overview: source.jobOverview || source.description, responsibilities: source.responsibilities || source.description, requiredQualifications: source.requiredQualifications || source.description, preferredQualifications: source.preferredQualifications || "", technicalRequirements: source.technicalRequirements || "", benefitsAndPerks: source.benefitsAndPerks || "", equalOpportunityStatement: source.equalOpportunityStatement || "" },
    skills: { required: source.skills.filter((x) => x.kind === "REQUIRED").map((x) => x.name), preferred: source.skills.filter((x) => x.kind === "PREFERRED").map((x) => x.name), technical: source.skills.filter((x) => x.kind === "TECHNICAL").map((x) => x.name), soft: source.skills.filter((x) => x.kind === "SOFT").map((x) => x.name), education: source.requirements.filter((x) => x.kind === "EDUCATION").map((x) => ({ name: x.name, minimum: x.minimum || "", preferred: x.preferred })), certifications: source.requirements.filter((x) => x.kind === "CERTIFICATION").map((x) => x.name), languages: source.requirements.filter((x) => x.kind === "LANGUAGE").map((x) => x.name), specialization: "" },
    compensation: { minimum: source.salaryMin, maximum: source.salaryMax, currency: source.salaryCurrency, period: source.salaryPeriod, disclose: source.salaryDisclosure, incentives: source.incentives || "", bonus: source.bonus || "", benefits: source.benefits.map((x) => x.name), otherBenefits: "" },
    application: { method: source.applicationMethod, externalUrl: source.externalApplyUrl || "", deadline: "", resumeRequired: source.resumeRequired, coverLetterRequired: source.coverLetterRequired, allowUpdates: source.allowApplicationUpdates, collectAdditionalInformation: source.collectAdditionalInformation, confirmationEmail: source.confirmationEmail, maxApplications: source.maxApplications },
    screening: source.screeningQuestions.map((q) => ({ prompt: q.prompt, type: q.type, required: q.required, mustHave: q.mustHave, knockout: q.knockout, rejectionMessage: q.rejectionMessage || "", options: q.options.map((option) => option.label), active: q.active })), team: { members: [] },
    preferences: { urgent: source.urgentHiring, immediateJoining: source.immediateJoining, backgroundVerification: source.backgroundVerification, workAuthorization: source.workAuthorization || "", interviewRounds: source.interviewRounds, expectedJoiningDate: "", visibility: source.visibility }, planCode: "",
  } } });
  await prisma.$transaction(async (tx) => {
    if (source.skills.length) await tx.jobSkill.createMany({ data: source.skills.map(({ id, jobId, ...x }) => ({ ...x, jobId: job.id })) });
    if (source.requirements.length) await tx.jobRequirement.createMany({ data: source.requirements.map(({ id, jobId, ...x }) => ({ ...x, jobId: job.id })) });
    if (source.benefits.length) await tx.jobBenefit.createMany({ data: source.benefits.map(({ id, jobId, ...x }) => ({ ...x, jobId: job.id })) });
    for (const [index, q] of source.screeningQuestions.entries()) await tx.jobScreeningQuestion.create({ data: { prompt: q.prompt, type: q.type, required: q.required, mustHave: q.mustHave, knockout: q.knockout, rejectionMessage: q.rejectionMessage, displayOrder: index, active: q.active, jobId: job.id, options: { create: q.options.map(({ label, value }) => ({ label, value })) } } });
    if (source.applicationSetting) await tx.jobApplicationSetting.create({ data: { jobId: job.id, method: source.applicationSetting.method, externalUrl: source.applicationSetting.externalUrl, resumeRequired: source.applicationSetting.resumeRequired, coverLetterRequired: source.applicationSetting.coverLetterRequired, allowUpdates: source.applicationSetting.allowUpdates, collectAdditionalInformation: source.applicationSetting.collectAdditionalInformation, confirmationEmail: source.applicationSetting.confirmationEmail, maxApplications: source.applicationSetting.maxApplications } });
  });
  res.status(201).json({ job, message: "Job duplicated as a draft. Review it before submitting." });
});

jobsRouter.post("/:id/renew", requireAuth("RECRUITER"), async (req, res) => {
  const policy=await getJobPostingPolicy();
  if(!policy.allowRenewals)return res.status(403).json({error:"Job renewals are disabled by the platform administrator"});
  const employer = await prisma.employer.findUnique({ where: { userId: userOf(req).id }, select: { id: true } });
  const job = await prisma.job.findFirst({ where: { id: String(req.params.id), employerId: employer?.id } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (!["EXPIRED", "CLOSED", "PAUSED"].includes(job.status)) return res.status(409).json({ error: "Only expired, closed or paused jobs can be renewed" });
  const updated = await prisma.$transaction(async (tx) => {
    const renewed = await tx.job.update({ where: { id: job.id }, data: { status: "PENDING_REVIEW", expiresAt: null } });
    await tx.jobStatusHistory.create({ data: { jobId: job.id, previousStatus: job.status, newStatus: "PENDING_REVIEW", changedById: userOf(req).id, reason: "Job renewal submitted for review" } });
    return renewed;
  });
  res.json({ job: updated, message: "Renewal submitted for review." });
});

jobsRouter.get("/:id", async (req, res) => {
  const job = await prisma.job.findFirst({ where: { id: String(req.params.id), status: "PUBLISHED", visibility:"PUBLIC", AND:[{OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}] }, include: { employer: { select: { name: true, verified: true, city: true, state:true, industry:true } }, skills:{orderBy:{name:"asc"}}, requirements:{orderBy:{name:"asc"}}, benefits:{orderBy:{name:"asc"}} } });
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({ job });
});

