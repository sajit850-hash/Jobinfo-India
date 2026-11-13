export const API = "";
export const API_SERVER = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type Job = {
  id: string; title: string; company: string; verified: boolean; location: string;
  category: string | null; experienceMin: number | null; experienceMax: number | null;
  salaryMin: number | null; salaryMax: number | null; employmentType?: string | null;
  salaryCurrency?: string | null; salaryPeriod?: string | null;
  workplaceType?: "ON_SITE" | "REMOTE" | "HYBRID" | null; createdAt?: string;
  featured?: boolean;
  skills?: { name: string; kind: string }[];
};

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; data: T & { error?: string } }> {
  try {
    const res = await fetch(API + path, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "Cannot reach the server. Please try again." } as T & { error: string } };
  }
}

export const expLabel = (j: Job) =>
  j.experienceMax === 0 ? "Fresher" : j.experienceMin != null ? `${j.experienceMin}-${j.experienceMax} yrs` : "";
export const salaryLabel = (j: Job) => {
  if(j.salaryMin==null)return "Not disclosed";
  const currency=/^[A-Z]{3}$/.test(j.salaryCurrency||"")?j.salaryCurrency! : "INR";
  const format=(amount:number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency,maximumFractionDigits:0}).format(amount);
  const range=j.salaryMax!=null&&j.salaryMax!==j.salaryMin?`${format(j.salaryMin)}–${format(j.salaryMax)}`:format(j.salaryMin);
  const period=({ANNUAL:"per year",MONTHLY:"per month",DAILY:"per day",HOURLY:"per hour"} as Record<string,string>)[j.salaryPeriod||"ANNUAL"]||"per year";
  return `${range} ${period}`;
};
