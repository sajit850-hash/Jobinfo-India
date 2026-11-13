import { z } from "zod";
import { prisma } from "@jobinfo/database";

export const JOB_POSTING_POLICY_KEY = "job_posting_policy";

export const jobPostingPolicySchema = z.object({
  enabled: z.boolean(),
  freePostingEnabled: z.boolean(),
  requireApproval: z.boolean(),
  allowEditsAfterApproval: z.boolean(),
  allowRenewals: z.boolean(),
  maxActiveFreeJobs: z.number().int().min(0).max(1000),
  expiryDays: z.number().int().min(1).max(3650),
  maxOpenings: z.number().int().min(1).max(100_000),
  requireVerifiedRecruiter: z.boolean(),
});

export type JobPostingPolicy = z.infer<typeof jobPostingPolicySchema>;

export const defaultJobPostingPolicy: JobPostingPolicy = {
  enabled: true,
  freePostingEnabled: true,
  requireApproval: true,
  allowEditsAfterApproval: false,
  allowRenewals: true,
  maxActiveFreeJobs: 3,
  expiryDays: 30,
  maxOpenings: 1000,
  requireVerifiedRecruiter: false,
};

export async function getJobPostingPolicy(): Promise<JobPostingPolicy> {
  const setting = await prisma.platformSetting.findUnique({ where: { key: JOB_POSTING_POLICY_KEY }, select: { value: true } });
  if (!setting) return defaultJobPostingPolicy;
  const result = jobPostingPolicySchema.safeParse(setting.value);
  return result.success ? result.data : defaultJobPostingPolicy;
}
