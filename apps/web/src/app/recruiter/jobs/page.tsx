"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

type Job = { id:string; title:string; description:string; location:string; category:string|null; employmentType:string|null; experienceMin:number|null; experienceMax:number|null; salaryMin:number|null; salaryMax:number|null; status:string; draft?:{currentStep:number}|null; _count:{applications:number} };
export default function RecruiterJobs() {
  const [jobs, setJobs] = useState<Job[]>([]); const [editing, setEditing] = useState<Job|null>(null); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState("");
  const refresh = () => api<{data:Job[]}>("/api/v1/jobs/mine").then((r) => r.ok ? setJobs(r.data.data) : setError(r.data.error || "Sign in as a recruiter to manage jobs."));
  useEffect(() => { void refresh(); }, []);
  const status = async (job: Job, next: string) => {
    if (next === "CLOSED" && !window.confirm(`Close “${job.title}”? Closed jobs cannot be reopened.`)) return;
    setBusy(job.id); setError(""); setMessage("");
    const r = await api(`/api/v1/jobs/${job.id}/status`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    setBusy(""); if (!r.ok) setError(r.data.error || "Could not update job"); else { setMessage(next === "PAUSED" ? "Job paused." : next === "CLOSED" ? "Job closed." : "Job submitted for review."); void refresh(); }
  };
  const jobAction = async (job: Job, action: "duplicate" | "renew") => {
    setBusy(job.id); setError(""); setMessage("");
    const r = await api<{ job?: { id: string }; message?: string }>(`/api/v1/jobs/${job.id}/${action}`, { method: "POST" });
    setBusy("");
    if (!r.ok) setError(r.data.error || `Could not ${action} job`);
    else if (action === "duplicate" && r.data.job?.id) window.location.assign(`/recruiter/jobs/new?draft=${r.data.job.id}`);
    else { setMessage(r.data.message || "Renewal submitted for review."); void refresh(); }
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editing) return; const form = new FormData(event.currentTarget); setBusy(editing.id); setError("");
    const num = (name:string) => form.get(name) ? Number(form.get(name)) : null;
    const r = await api<{ message?: string }>(`/api/v1/jobs/${editing.id}`, { method: "PATCH", body: JSON.stringify({ title:form.get("title"), description:form.get("description"), location:form.get("location"), category:form.get("category") || undefined, employmentType:form.get("employmentType") || undefined, experienceMin:num("experienceMin"), experienceMax:num("experienceMax"), salaryMin:num("salaryMin"), salaryMax:num("salaryMax") }) });
    setBusy(""); if (!r.ok) setError(r.data.error || "Could not save changes"); else { setMessage(r.data.message || "Job updated."); setEditing(null); void refresh(); }
  };
  return <Page><main className="wrap section recruiterJobs"><div className="sectionTitle"><div><p className="eyebrow">RECRUITER WORKSPACE</p><h1>Job management</h1></div><Link className="btn" href="/recruiter/jobs/new">Post a job</Link></div>
    {error && <div className="err">{error} <Link href="/login">Sign in</Link></div>}{message && <div className="info">{message}</div>}
    <div className="applicationList">{jobs.map((job) => <article className="card managedJob" key={job.id}>
      <div className="managedJobHead"><div><h2>{job.title}</h2><p className="muted">{job.location} · {job.category || "Uncategorized"} · {job._count.applications} applications</p></div><span className={`statusPill status-${job.status.toLowerCase()}`}>{job.status.replaceAll("_", " ")}</span></div>
      {editing?.id === job.id ? <form className="jobEditForm" onSubmit={save}>
        <div className="row2"><label className="field">Title<input name="title" defaultValue={job.title} required minLength={3} /></label><label className="field">Location<input name="location" defaultValue={job.location} required /></label></div>
        <div className="row2"><label className="field">Category<input name="category" defaultValue={job.category || ""} /></label><label className="field">Employment type<input name="employmentType" defaultValue={job.employmentType || ""} /></label></div>
        <label className="field">Description<textarea name="description" defaultValue={job.description} required minLength={30} rows={6} /></label>
        <div className="row2"><label className="field">Min experience<input name="experienceMin" type="number" min="0" defaultValue={job.experienceMin ?? ""} /></label><label className="field">Max experience<input name="experienceMax" type="number" min="0" defaultValue={job.experienceMax ?? ""} /></label></div>
        <div className="row2"><label className="field">Min salary (LPA)<input name="salaryMin" type="number" min="0" defaultValue={job.salaryMin ?? ""} /></label><label className="field">Max salary (LPA)<input name="salaryMax" type="number" min="0" defaultValue={job.salaryMax ?? ""} /></label></div>
        {job.status === "PUBLISHED" && <p className="note">Saving edits sends this published job back for review.</p>}
        <button className="btn" disabled={busy === job.id}>{busy === job.id ? "Saving…" : "Save changes"}</button><button className="btn outline" type="button" onClick={() => setEditing(null)}>Cancel</button>
      </form> : <div className="managedJobActions">
        {job.status !== "CLOSED" && <button className="btn outline sm" onClick={() => { setEditing(job); setMessage(""); }}>Edit</button>}
        {job.status === "PUBLISHED" && <button className="btn outline sm" disabled={busy === job.id} onClick={() => status(job,"PAUSED")}>Pause</button>}
        {job.status === "PAUSED" && <button className="btn outline sm" disabled={busy === job.id} onClick={() => status(job,"PENDING_REVIEW")}>Resume &amp; review</button>}
        {["CHANGES_REQUESTED", "REJECTED"].includes(job.status) && job.draft && <Link className="btn sm" href={`/recruiter/jobs/new?draft=${job.id}`}>Edit &amp; resubmit</Link>}
        {(["EXPIRED", "CLOSED", "PAUSED"].includes(job.status)) && <button className="btn outline sm" disabled={busy === job.id} onClick={() => jobAction(job,"renew")}>Renew</button>}
        <button className="btn outline sm" disabled={busy === job.id} onClick={() => jobAction(job,"duplicate")}>Duplicate</button>
        {job.status !== "CLOSED" && <button className="btn outline sm danger" disabled={busy === job.id} onClick={() => status(job,"CLOSED")}>Close job</button>}
        <Link className="textLink" href="/recruiter/applications">Review applicants →</Link>
      </div>}
    </article>)}</div>
    {!error && jobs.length === 0 && <div className="card emptyState"><h2>No jobs yet</h2><p className="muted">Create a job listing and track it through review and hiring.</p><Link className="btn" href="/recruiter/jobs/new">Post your first job</Link></div>}
  </main></Page>;
}
