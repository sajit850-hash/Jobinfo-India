"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

export default function CandidateDashboard() {
  const [candidate, setCandidate] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api<{candidate:any}>("/api/v1/candidates/me"), api<{data:any[]}>("/api/v1/applications/mine"), api<{data:any[]}>("/api/v1/candidates/saved-jobs")])
      .then(([profile, apps, saved]) => {
        if (!profile.ok) { setError(profile.data.error || "Please sign in as a candidate."); return; }
        setCandidate(profile.data.candidate); if (apps.ok) setApplications(apps.data.data); if (saved.ok) setSavedCount(saved.data.data.length);
      });
  }, []);
  return <Page><main className="wrap section">
    <div className="sectionTitle"><div><p className="eyebrow">CANDIDATE WORKSPACE</p><h1>Welcome{candidate?.user?.fullName ? `, ${candidate.user.fullName}` : ""}</h1></div><Link className="btn outline" href="/account/security">Security &amp; privacy</Link></div>
    {error && <div className="err">{error} <Link href="/login">Sign in</Link></div>}
    {!candidate && !error && <p className="muted">Loading your dashboard…</p>}
    {candidate && <>
      {!candidate.profileComplete && <div className="notice warning">Your candidate profile is still in progress. <Link className="textLink" href="/register/candidate">Resume registration</Link> or edit your profile.</div>}
      <div className="grid3 dashboardStats"><article className="card"><span className="muted">Applications</span><strong>{applications.length}</strong><Link href="/candidate/applications">Track applications →</Link></article>
        <article className="card"><span className="muted">Saved jobs</span><strong>{savedCount}</strong><Link href="/candidate/saved-jobs">View saved jobs →</Link></article>
        <article className="card"><span className="muted">Profile</span><strong>{candidate.profileComplete ? "Ready" : "In progress"}</strong><Link href="/candidate/profile">Edit profile →</Link></article></div>
      <div className="candidateDashboardGrid"><section className="card"><div className="sectionTitle"><h2>Recent applications</h2><Link className="textLink" href="/candidate/applications">See all</Link></div>
        {applications.length ? applications.slice(0, 5).map((application) => <div className="dashboardRow" key={application.id}><div><b>{application.job.title}</b><small>{application.job.employer.name} · {application.job.location}</small></div><span className="statusPill">{application.status}</span></div>) : <p className="muted">No applications yet. <Link className="textLink" href="/jobs">Explore open jobs</Link>.</p>}
      </section><aside className="card"><h2>Profile checklist</h2><p className="checkLine">{candidate.headline ? "✓" : "○"} Professional headline</p><p className="checkLine">{candidate.skills?.length ? "✓" : "○"} Add your skills</p><p className="checkLine">{candidate.education?.length ? "✓" : "○"} Add education</p><p className="checkLine">{candidate.hasResume ? "✓" : "○"} Upload your resume</p><Link className="btn block" href="/candidate/profile">Complete your profile</Link></aside></div>
    </>}
  </main></Page>;
}
