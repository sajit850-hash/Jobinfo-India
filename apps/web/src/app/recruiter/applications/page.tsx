"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

const actions = ["VIEWED", "SHORTLISTED", "INTERVIEW", "OFFERED", "HIRED", "REJECTED"];
export default function RecruiterApplications() {
  const [rows, setRows] = useState<any[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState(""); const [filter, setFilter] = useState("ALL");
  const refresh = () => api<{data:any[]}>("/api/v1/applications/recruiter").then((r) => r.ok ? setRows(r.data.data) : setError(r.data.error || "Sign in as a recruiter to view applicants."));
  useEffect(() => { void refresh(); }, []);
  const update = async (id: string, status: string) => { setBusy(id); setError(""); const r = await api(`/api/v1/applications/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); setBusy(""); if (!r.ok) setError(r.data.error || "Could not update application"); else void refresh(); };
  const filtered = filter === "ALL" ? rows : rows.filter((x) => x.status === filter);
  return <Page><main className="wrap section"><p className="eyebrow">RECRUITER WORKSPACE</p><h1>Applications</h1>
    {error && <div className="err">{error} <Link href="/login">Sign in</Link></div>}
    <label className="field applicationFilter">Filter by status<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="ALL">All statuses</option>{actions.map((x) => <option key={x}>{x}</option>)}</select></label>
    <div className="applicationList">{filtered.map((item) => <article className="card recruiterApplication" key={item.id}>
      <div className="recruiterApplicationHead"><div><h2>{item.candidate.user.fullName}</h2><p className="muted">Applied for <b>{item.job.title}</b> · {new Date(item.appliedAt).toLocaleDateString()}</p><p className="muted">{item.candidate.experienceYears == null ? "Experience not specified" : item.candidate.experienceYears === 0 ? "Fresher" : `${item.candidate.experienceYears} years experience`}</p></div><span className={`statusPill status-${item.status.toLowerCase()}`}>{item.status}</span></div>
      {item.candidate.headline && <p>{item.candidate.headline}</p>}{item.candidate.summary && <p className="muted">{item.candidate.summary}</p>}
      <div className="tags">{item.candidate.skills.map((x:any)=><span className="tag" key={x.id}>{x.name}</span>)}</div>
      {item.candidate.education.length > 0 && <p className="muted">{item.candidate.education.map((x:any)=>`${x.degree} · ${x.institution}`).join("; ")}</p>}
      {item.candidate.workExperience.length > 0 && <p className="muted">Recent experience: {item.candidate.workExperience.slice(0,2).map((x:any)=>`${x.title} at ${x.company}`).join("; ")}</p>}
      {item.coverLetter && <details className="coverLetter"><summary>Read cover letter</summary><p>{item.coverLetter}</p></details>}
      <div className="applicationActions"><Link className="btn outline sm" href={`/recruiter/candidates/${item.candidateId}`}>View candidate profile</Link>{actions.filter((x) => x !== item.status).map((status) => <button className={status === "REJECTED" ? "btn outline sm danger" : "btn outline sm"} key={status} disabled={busy === item.id} onClick={() => update(item.id, status)}>{status === "SHORTLISTED" ? "Shortlist" : status === "REJECTED" ? "Reject" : status}</button>)}</div>
    </article>)}</div>
    {!error && filtered.length === 0 && <div className="card emptyState"><h2>No applications found</h2><p className="muted">Applications for your job postings will appear here.</p></div>}
  </main></Page>;
}
