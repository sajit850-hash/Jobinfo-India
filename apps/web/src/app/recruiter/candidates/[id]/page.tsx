"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

export default function CandidateProfileView() {
  const params = useParams<{id:string}>(); const [candidate, setCandidate] = useState<any>(null); const [error, setError] = useState("");
  useEffect(() => { api<{candidate:any}>(`/api/v1/recruiters/candidates/${params.id}`).then((r) => r.ok ? setCandidate(r.data.candidate) : setError(r.data.error || "Could not load candidate")); }, [params.id]);
  return <Page><main className="wrap section candidateView"><Link className="textLink" href="/recruiter/candidates">← Candidate search</Link>
    {error && <div className="err">{error}</div>}{!candidate && !error && <p className="muted">Loading candidate…</p>}
    {candidate && <><header className="card"><p className="eyebrow">CANDIDATE PROFILE</p><h1>{candidate.user.fullName}</h1><h2>{candidate.headline || ""}</h2><p className="muted">{[candidate.city, candidate.state].filter(Boolean).join(", ")} {candidate.experienceYears != null ? `· ${candidate.experienceYears === 0 ? "Fresher" : `${candidate.experienceYears} years experience`}` : ""}</p>{candidate.hasResume&&<a className="btn" href={`/api/v1/recruiters/candidates/${candidate.id}/resume`}>Download authorized resume</a>}</header>
      {candidate.summary && <section className="card"><h2>About</h2><p>{candidate.summary}</p></section>}
      <section className="card"><h2>Skills</h2><div className="tags">{candidate.skills.map((x:any)=><span className="tag" key={x.id}>{x.name}</span>)}</div></section>
      <section className="card"><h2>Education</h2>{candidate.education.map((x:any)=><article className="candidateHistory" key={x.id}><h3>{x.degree}{x.field ? ` · ${x.field}` : ""}</h3><p>{x.institution}{x.department ? ` · ${x.department}` : ""}{x.passingYear ? ` · ${x.passingYear}` : ""}</p></article>)}</section>
      <section className="card"><h2>Work experience</h2>{candidate.workExperience.map((x:any)=><article className="candidateHistory" key={x.id}><h3>{x.title}</h3><p>{x.company}{x.location ? ` · ${x.location}` : ""}</p><small>{new Date(x.startDate).toLocaleDateString()} – {x.current ? "Present" : x.endDate ? new Date(x.endDate).toLocaleDateString() : ""}</small>{x.description && <p>{x.description}</p>}</article>)}</section>
      {candidate.certifications.length > 0 && <section className="card"><h2>Certifications</h2>{candidate.certifications.map((x:any)=><article className="candidateHistory" key={x.id}><h3>{x.name}</h3><p>{x.issuer}{x.issueYear ? ` · ${x.issueYear}` : ""}</p></article>)}</section>}
    </>}
  </main></Page>;
}
