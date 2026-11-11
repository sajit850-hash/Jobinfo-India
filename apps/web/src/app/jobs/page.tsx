import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { API_SERVER as API, Job, expLabel, salaryLabel } from "@/lib/api";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Find jobs in India", description: "Search job openings by title, skills, company and location on Jobinfo India." };

export default async function Jobs({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries(sp).filter(([k]) => ["q", "location", "category", "page"].includes(k)));
  let jobs: Job[] = [], total = 0, failed = false;
  try {
    const r = await fetch(`${API}/api/v1/jobs?${qs}`, { cache: "no-store" });
    if (r.ok) { const j = await r.json(); jobs = j.data; total = j.total; } else failed = true;
  } catch { failed = true; }

  return (
    <Page>
      <section className="hero" style={{ padding: "36px 0" }}>
        <div className="wrap">
          <form className="search" action="/jobs">
            <input name="q" defaultValue={sp.q} placeholder="Job title, skill or company" />
            <input name="location" defaultValue={sp.location} placeholder="Location" />
          <input name="category" defaultValue={sp.category} placeholder="Category" />
            <button className="btn">Search Jobs</button>
          </form>
        </div>
      </section>
      <section className="wrap section">
        <h2>{sp.category ?? "All jobs"} <small>({total} found)</small></h2>
        {failed && <div className="err">Could not load jobs. Is the API running on port 4000?</div>}
        {!failed && jobs.length === 0 && <p className="muted">No jobs match your search.</p>}
        <div className="grid3">
          {jobs.map((j) => (
            <div className="card job" key={j.id}>
              <h3>{j.title}</h3><div className="co">{j.company}</div>
              <div className="tags">
                <span className="tag">{j.location}</span>
                {expLabel(j) && <span className="tag">{expLabel(j)}</span>}
                {j.verified && <span className="tag ok">Verified</span>}
              </div>
              <div className="jobFoot"><b>{salaryLabel(j)}</b><Link className="btn sm" href={`/job/${j.id}`}>View job</Link></div>
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}
