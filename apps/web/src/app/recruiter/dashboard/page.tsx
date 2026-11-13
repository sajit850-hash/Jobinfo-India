"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { DashboardShell } from "@/components/DashboardShell";
import { api } from "@/lib/api";

type RecruiterData = {
  employer: { name: string; website?: string | null; industry?: string | null; city?: string | null; jobs: any[] };
  summary: { totalJobs: number; publishedJobs: number; pendingApprovalJobs: number; applications: number; pendingApplications: number; shortlistedCandidates: number; upcomingInterviews: number };
};

export default function RecruiterDashboard() {
  const [data, setData] = useState<RecruiterData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [company, setCompany] = useState({ name: "", website: "", industry: "", city: "" });
  const [editing, setEditing] = useState(false);

  const refresh = async () => {
    try {
      const result = await api<RecruiterData>("/api/v1/recruiters/me");
      if (!result.ok) { setError(result.data.error || "Please sign in as a recruiter."); return; }
      setData(result.data);
      setCompany({ name: result.data.employer.name || "", website: result.data.employer.website || "", industry: result.data.employer.industry || "", city: result.data.employer.city || "" });
      setError("");
    } catch { setError("Could not reach the server while loading your recruiter dashboard. Refresh to try again."); }
  };
  useEffect(() => { void refresh(); }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const result = await api("/api/v1/recruiters/me", { method: "PATCH", body: JSON.stringify(company) });
    setBusy(false);
    if (!result.ok) setError(result.data.error || "Could not save company profile");
    else { setMessage("Company profile saved."); setEditing(false); await refresh(); }
  };

  return <Page><DashboardShell role="recruiter"><main className="wrap section recruiterDashboard">
    <header className="recruiterDashWelcome"><div><p className="eyebrow">RECRUITER WORKSPACE</p><h1>Welcome{data?.employer?.name ? `, ${data.employer.name}` : ""}</h1><p className="muted">Track job activity and move candidates through your hiring pipeline.</p></div><Link className="btn" href="/recruiter/jobs/new">＋ Post a job</Link></header>
    {error && <div className="err" role="alert">{error} <Link href="/login">Sign in</Link></div>}{message && <div className="info" role="status">{message}</div>}
    {!data && !error ? <p className="muted">Loading your workspace…</p> : data && <>
      <section className="recruiterDashMetrics" aria-label="Recruiter activity">
        <Link className="card recruiterDashMetric" href="/recruiter/jobs?filter=all"><span>Total jobs</span><strong>{data.summary.totalJobs}</strong><small>All your job posts</small></Link>
        <Link className="card recruiterDashMetric" href="/recruiter/jobs?filter=active"><span>Active jobs</span><strong>{data.summary.publishedJobs}</strong><small>Currently accepting applications</small></Link>
        <Link className="card recruiterDashMetric" href="/recruiter/applications"><span>Total applicants</span><strong>{data.summary.applications}</strong><small>{data.summary.pendingApplications} awaiting review</small></Link>
        <Link className="card recruiterDashMetric" href="/recruiter/applications?status=SHORTLISTED"><span>Shortlisted</span><strong>{data.summary.shortlistedCandidates}</strong><small>{data.summary.upcomingInterviews} upcoming interviews</small></Link>
      </section>

      <section className="card recruiterDashJobs">
        <div className="sectionTitle"><div><p className="eyebrow">RECRUITMENT</p><h2>Job overview</h2></div><Link className="textLink" href="/recruiter/jobs?filter=all">View all jobs →</Link></div>
        {data.employer.jobs.length ? <div className="recruiterDashTableScroll"><table className="recruiterDashTable"><thead><tr><th>Job title / client</th><th>Status</th><th>Applicants</th><th>Shortlisted</th><th>Pending</th><th>Rejected</th><th>Action</th></tr></thead><tbody>{data.employer.jobs.slice(0, 8).map((job: any) => <tr key={job.id}>
          <td><b>{job.title}</b><small>{data.employer.name} · {job.location}</small></td>
          <td><span className={`statusPill ${["PUBLISHED", "ACTIVE"].includes(job.status) ? "status-hired" : ["CLOSED", "ARCHIVED", "EXPIRED"].includes(job.status) ? "status-closed" : "status-pending"}`}>{job.status.replaceAll("_", " ")}</span></td>
          <td>{job.applicationSummary?.total ?? job._count.applications}</td><td>{job.applicationSummary?.shortlisted ?? 0}</td><td>{job.applicationSummary?.pending ?? 0}</td><td>{job.applicationSummary?.rejected ?? 0}</td>
          <td><Link className="textLink" href={`/recruiter/applications?jobId=${encodeURIComponent(job.id)}`}>Track</Link></td>
        </tr>)}</tbody></table></div> : <div className="recruiterDashEmpty"><h3>No jobs posted yet</h3><p className="muted">Create a listing to start receiving applications.</p><Link className="btn" href="/recruiter/jobs/new">Post your first job</Link></div>}
      </section>

      <section className="card companyProfileCard" id="company-profile"><div className="sectionTitle"><div><p className="eyebrow">COMPANY PROFILE</p><h2>{data.employer.name}</h2></div><button className="btn outline sm" onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Edit profile"}</button></div>
        {!editing ? <p className="muted">{[data.employer.industry, data.employer.city, data.employer.website].filter(Boolean).join(" · ") || "Add company details to help candidates learn about your organization."}</p> : <form className="companyForm" onSubmit={save}>
          <label className="field">Company / recruiter name<input required value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} /></label>
          <div className="row2"><label className="field">Website<input type="url" value={company.website} onChange={(e) => setCompany({ ...company, website: e.target.value })} /></label><label className="field">Industry<input value={company.industry} onChange={(e) => setCompany({ ...company, industry: e.target.value })} /></label></div>
          <label className="field">City<input value={company.city} onChange={(e) => setCompany({ ...company, city: e.target.value })} /></label><button className="btn" disabled={busy}>{busy ? "Saving…" : "Save company profile"}</button>
        </form>}
      </section>
      <section className="recruiterDashQuickLinks" aria-label="Recruiter tools"><Link className="card" href="/recruiter/ats"><b>ATS candidate matching</b><span>Match candidate profiles to your jobs</span></Link><Link className="card" href="/recruiter/candidates"><b>Search candidates</b><span>Find candidates by skills and experience</span></Link><Link className="card" href="/recruiter/billing"><b>Plans and billing</b><span>Manage subscriptions and invoices</span></Link></section>
    </>}
  </main></DashboardShell></Page>;
}
