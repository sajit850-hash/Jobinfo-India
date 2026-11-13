"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

export default function CandidateApplications() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { api<{data:any[]}>("/api/v1/applications/mine").then((r) => r.ok ? setRows(r.data.data) : setError(r.data.error || "Please sign in as a candidate.")).catch(()=>setError("Could not reach the server while loading applications.")); }, []);
  return <Page><main className="wrap section"><p className="eyebrow">CANDIDATE WORKSPACE</p><h1>My applications</h1>
    {error && <div className="err">{error} <Link href="/login">Sign in</Link></div>}
    <div className="applicationList">{rows.map((application) => <article className="card applicationCard" key={application.id}>
      <div><h2>{application.job.title}</h2><p className="muted">{application.job.employer.name} · {application.job.location}</p><small>Applied {new Date(application.appliedAt).toLocaleDateString()}</small></div>
      <div><span className={`statusPill status-${application.status.toLowerCase()}`}>{application.status.replaceAll("_"," ")}</span>{application.statusHistory?.length>0&&<details className="applicationTimeline"><summary>Application timeline</summary><ol>{application.statusHistory.map((event:any)=><li key={event.id}><b>{event.newStatus.replaceAll("_"," ")}</b><small>{event.note||"Status updated"} · {new Date(event.changedAt).toLocaleString()}</small></li>)}</ol></details>}</div>
    </article>)}</div>
    {!error && rows.length === 0 && <div className="card emptyState"><h2>No applications yet</h2><p className="muted">Your applications and their latest status will show here.</p><Link className="btn" href="/jobs">Find jobs</Link></div>}
  </main></Page>;
}
