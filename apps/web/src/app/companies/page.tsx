import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { API_SERVER } from "@/lib/api";

export const metadata: Metadata = {
  title: "Companies hiring in India",
  description: "Explore verified companies with open roles on Jobinfo India.",
};

type Company = { id: string; name: string; website: string | null; industry: string | null; city: string | null };

function safeWebsite(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch { return null; }
}

async function getCompanies(): Promise<Company[]> {
  try {
    const response = await fetch(`${API_SERVER}/api/v1/companies`, { next: { revalidate: 300 } });
    if (!response.ok) return [];
    return (await response.json()).data as Company[];
  } catch { return []; }
}

export default async function CompaniesPage() {
  const companies = await getCompanies();
  return <Page><main className="wrap section">
    <p className="eyebrow">VERIFIED EMPLOYERS</p><h1>Companies hiring in India</h1>
    <p className="lead2">Discover verified employers and explore their current opportunities.</p>
    {companies.length ? <div className="grid3 directoryGrid">{companies.map((company) => <article className="card" key={company.id}>
      <h2>{company.name}</h2><p className="muted">{[company.industry, company.city].filter(Boolean).join(" · ") || "India"}</p>
      <div className="directoryLinks"><Link className="btn outline sm" href={`/jobs?q=${encodeURIComponent(company.name)}`}>View open jobs</Link>
        {safeWebsite(company.website) && <a className="textLink" href={safeWebsite(company.website)!} target="_blank" rel="noreferrer">Company website ↗</a>}</div>
    </article>)}</div> : <div className="card emptyState"><h2>More companies are joining</h2><p className="muted">Verified employers with published jobs will appear here. Browse current openings in the meantime.</p><Link className="btn" href="/jobs">Find jobs</Link></div>}
  </main></Page>;
}
