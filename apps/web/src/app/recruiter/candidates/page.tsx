"use client";
import { FormEvent, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

export default function CandidateSearch() {
  const [q, setQ] = useState(""); const [location, setLocation] = useState(""); const [department, setDepartment] = useState(""); const [skills, setSkills] = useState("");
  const [source, setSource] = useState("ALL"); const [passingYear, setPassingYear] = useState("");
  const [rows, setRows] = useState<any[]>([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(false); const [searched, setSearched] = useState(false);
  async function search(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setSearched(true);
    const params = new URLSearchParams(); if (q.trim()) params.set("q", q); if (location.trim()) params.set("location", location); if (department.trim()) params.set("department", department); if (skills.trim()) params.set("skills", skills); if (passingYear) params.set("passingYear", passingYear);
    const result = await api<{data:any[]}>(`${source === "INSTITUTIONS" ? "/api/v1/institutions/candidates" : "/api/v1/recruiters/candidates"}?${params}`);
    setLoading(false); if (!result.ok) { setRows([]); setError(result.data.error || "Candidate search failed"); } else setRows(result.data.data);
  }
  return <Page><main className="wrap section recruiterSearch"><p className="eyebrow">RECRUITER WORKSPACE</p><h1>Search candidates</h1>
    <p className="lead2">Search profiles shared by candidates. Combine terms with AND, OR, NOT and parentheses.</p>
    <form className="card recruiterSearchForm" onSubmit={search}>
      <label className="field">Candidate pool<select value={source} onChange={(e) => setSource(e.target.value)}><option value="ALL">Profiles shared by candidates</option><option value="INSTITUTIONS">Opted-in institution students</option></select></label>
      <label className="field">Boolean keywords<input value={q} onChange={(e) => setQ(e.target.value)} placeholder={'e.g. React AND ("frontend engineer" OR TypeScript) NOT internship'} /></label>
      <div className="row2"><label className="field">City or state<input value={location} onChange={(e) => setLocation(e.target.value)} /></label><label className="field">Department<input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Computer Science" /></label></div>
      {source === "INSTITUTIONS" && <label className="field">Passing year<input type="number" min="1990" max="2100" value={passingYear} onChange={(e) => setPassingYear(e.target.value)} placeholder="e.g. 2026" /></label>}
      <label className="field">Skills (comma separated, all required)<input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="React, SQL" /></label>
      <button className="btn" disabled={loading}>{loading ? "Searching…" : "Search candidates"}</button>
    </form>
    {error && <div className="err">{error}</div>}
    {rows.length > 0 && <><p className="muted">{rows.length} candidate profiles found on this page.</p><div className="grid3">{rows.map((c) => <article className="card candidateResult" key={c.id}>
      <p className="eyebrow">{c.city || c.state ? [c.city, c.state].filter(Boolean).join(", ") : "Location not specified"}</p><h2>{c.user.fullName}</h2><h3>{c.headline || "Candidate profile"}</h3>
      {c.experienceYears != null && <p className="muted">{c.experienceYears === 0 ? "Fresher" : `${c.experienceYears} years experience`}</p>}
      <div className="tags">{c.skills.slice(0, 6).map((s: any) => <span className="tag" key={s.name || s}>{s.name || s}</span>)}</div>
      {source === "INSTITUTIONS" ? <><small>{c.degree || "Student"} · Class of {c.passingYear}</small><small>Listed by {c.institution.name} · {c.institution.city}, {c.institution.state}</small>{c.email && <a className="btn outline sm" href={`mailto:${c.email}`}>Contact candidate</a>}</> : <><small>{c.education[0] && `${c.education[0].degree}${c.education[0].department ? ` · ${c.education[0].department}` : ""}`}</small><Link className="btn outline sm" href={`/recruiter/candidates/${c.id}`}>View profile</Link></>}
    </article>)}</div></>}
    {searched && !loading && !error && rows.length === 0 && <div className="card emptyState"><h2>No matching shared profiles</h2><p className="muted">Try fewer terms or broader filters. Candidates control whether recruiters can discover their profiles.</p></div>}
  </main></Page>;
}
