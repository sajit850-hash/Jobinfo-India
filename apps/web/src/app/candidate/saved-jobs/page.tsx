"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

export default function CandidateSavedJobs() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const refresh = () => api<{data:any[]}>("/api/v1/candidates/saved-jobs").then((r) => r.ok ? setRows(r.data.data) : setError(r.data.error || "Please sign in as a candidate."));
  useEffect(() => { void refresh(); }, []);
  const remove = async (jobId: string) => { const r = await api(`/api/v1/candidates/saved-jobs/${jobId}`, { method: "DELETE" }); if (r.ok) setRows((current) => current.filter((x) => x.jobId !== jobId)); else setError(r.data.error || "Could not remove saved job"); };
  return <Page><main className="wrap section"><p className="eyebrow">CANDIDATE WORKSPACE</p><h1>Saved jobs</h1>
    {error && <div className="err">{error} <Link href="/login">Sign in</Link></div>}
    <div className="applicationList">{rows.map(({ job }) => <article className="card applicationCard" key={job.id}><div>
      <h2><Link href={`/job/${job.id}`}>{job.title}</Link></h2><p className="muted">{job.employer.name} · {job.location}</p>
      {job.status === "PUBLISHED" ? <Link className="textLink" href={`/job/${job.id}`}>View job and apply →</Link> : <span className="statusPill">No longer available</span>}
    </div><button className="btn outline sm" type="button" onClick={() => remove(job.id)}>Remove</button></article>)}</div>
    {!error && rows.length === 0 && <div className="card emptyState"><h2>No saved jobs</h2><p className="muted">Save jobs that interest you and they will appear here.</p><Link className="btn" href="/jobs">Browse jobs</Link></div>}
  </main></Page>;
}
