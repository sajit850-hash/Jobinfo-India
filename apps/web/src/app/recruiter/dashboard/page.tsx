"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

export default function RecruiterDashboard() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [company, setCompany] = useState({ name: "", website: "", industry: "", city: "" });
  const [editing, setEditing] = useState(false);
  const refresh = () => api<any>("/api/v1/recruiters/me").then((r) => {
    if (!r.ok) { setError(r.data.error || "Please sign in as a recruiter."); return; }
    setData(r.data); setCompany({ name: r.data.employer.name || "", website: r.data.employer.website || "", industry: r.data.employer.industry || "", city: r.data.employer.city || "" });
  }).catch(()=>setError("Could not reach the server while loading your recruiter dashboard. Refresh to try again."));
  useEffect(() => { void refresh(); }, []);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const r = await api("/api/v1/recruiters/me", { method: "PATCH", body: JSON.stringify(company) });
    setBusy(false); if (!r.ok) setError(r.data.error || "Could not save company profile"); else { setMessage("Company profile saved."); setEditing(false); void refresh(); }
  };
  return <Page><main className="wrap section">
    <p className="eyebrow">RECRUITER WORKSPACE</p><h1>Welcome{data?.employer?.name ? `, ${data.employer.name}` : ""}</h1>
    {error && <div className="err">{error} <Link href="/login">Sign in</Link></div>}{message && <div className="info">{message}</div>}
    {!data && !error ? <p className="muted">Loading your workspace…</p> : data && <>
      <div className="dashboardStats recruiterStats">
        <article className="card"><span className="muted">Active jobs</span><strong>{data.summary.publishedJobs}</strong><Link href="/recruiter/jobs">Manage jobs →</Link></article>
        <article className="card"><span className="muted">Pending approvals</span><strong>{data.summary.pendingApprovalJobs}</strong><Link href="/recruiter/jobs">View submissions →</Link></article>
        <article className="card"><span className="muted">Applications received</span><strong>{data.summary.applications}</strong><Link href="/recruiter/applications">View pipeline →</Link></article>
        <article className="card"><span className="muted">Shortlisted</span><strong>{data.summary.shortlistedCandidates}</strong><Link href="/recruiter/applications">View shortlist →</Link></article>
        <article className="card"><span className="muted">Interviews scheduled</span><strong>{data.summary.upcomingInterviews}</strong><Link href="/recruiter/applications">Manage interviews →</Link></article>
      </div>
      <nav className="recruiterLinks"><Link className="card" href="/recruiter/jobs/new">Post a job</Link><Link className="card" href="/recruiter/jobs">Job management</Link><Link className="card" href="/recruiter/ats">ATS candidate matching</Link><Link className="card" href="/recruiter/candidates">Search candidates</Link><Link className="card" href="/recruiter/applications">Applications</Link><Link className="card" href="/recruiter/billing">Plans and billing</Link><Link className="card" href="/account/security">Security and privacy</Link></nav>
      <section className="card companyProfileCard"><div className="sectionTitle"><div><p className="eyebrow">COMPANY PROFILE</p><h2>{data.employer.name}</h2></div><button className="btn outline sm" onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Edit profile"}</button></div>
        {!editing ? <p className="muted">{[data.employer.industry, data.employer.city, data.employer.website].filter(Boolean).join(" · ") || "Add company details to help candidates learn about your organization."}</p> : <form className="companyForm" onSubmit={save}>
          <label className="field">Company / recruiter name<input required value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} /></label>
          <div className="row2"><label className="field">Website<input type="url" value={company.website} onChange={(e) => setCompany({ ...company, website: e.target.value })} /></label><label className="field">Industry<input value={company.industry} onChange={(e) => setCompany({ ...company, industry: e.target.value })} /></label></div>
          <label className="field">City<input value={company.city} onChange={(e) => setCompany({ ...company, city: e.target.value })} /></label><button className="btn" disabled={busy}>{busy ? "Saving…" : "Save company profile"}</button>
        </form>}
      </section>
      <section className="card" style={{ marginTop: 18 }}><h2>Recent jobs</h2>{data.employer.jobs.length ? <div className="applicationList">{data.employer.jobs.slice(0, 5).map((job: any) => <div className="dashboardRow" key={job.id}><div><b>{job.title}</b><small>{job.location} · {job.status} · {job._count.applications} applicants</small></div><Link className="textLink" href="/recruiter/jobs">Manage</Link></div>)}</div> : <p className="muted">No jobs posted yet. <Link className="textLink" href="/recruiter/jobs/new">Create your first job</Link>.</p>}</section>
    </>}
  </main></Page>;
}
