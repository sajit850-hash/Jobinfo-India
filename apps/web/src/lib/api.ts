export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
export const API_SERVER = process.env.API_INTERNAL_URL || API;

export type Job = {
  id: string; title: string; company: string; verified: boolean; location: string;
  category: string | null; experienceMin: number | null; experienceMax: number | null;
  salaryMin: number | null; salaryMax: number | null;
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
export const salaryLabel = (j: Job) =>
  j.salaryMin != null ? `${j.salaryMin}-${j.salaryMax} LPA` : "Not disclosed";
