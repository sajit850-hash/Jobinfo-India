"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Page } from "@/components/SiteChrome";
import { ResumeViewer } from "@/components/ResumeViewer";
import { api } from "@/lib/api";

type CandidateProfile = {
  id: string; headline?: string | null; summary?: string | null; careerObjective?: string | null;
  city?: string | null; state?: string | null; dateOfBirth?: string | null; gender?: string | null;
  experienceYears?: number | null; currentDesignation?: string | null; currentCompany?: string | null; currentIndustry?: string | null;
  currentSalary?: number | null; expectedSalary?: number | null; noticePeriod?: string | null; employmentType?: string | null;
  workMode?: string | null; preferredShift?: string | null; preferredJobRoles: string[]; preferredJobLocations: string[]; languages: string[];
  highestQualification?: string | null; course?: string | null; grade?: string | null; linkedinUrl?: string | null; portfolioUrl?: string | null;
  updatedAt: string; createdAt: string; profileCompletionPercentage: number; recruiterStatus: string; hasResume: boolean; hasPhoto: boolean;
  user: { fullName: string; emailVerifiedAt?: string | null; phoneVerifiedAt?: string | null; lastActiveAt?: string | null };
  skills: { name: string }[]; education: any[]; certifications: any[]; trainings: any[]; workExperience: any[];
  recruiterComments: { id: string; body: string; createdAt: string }[];
  aiMatches: { recommendationId: string; createdAt: string; criteria: any; match: any }[];
};

const money = (amount?: number | null) => amount == null ? "Not provided" : `INR ${(amount / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} LPA`;
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Not provided";
const duration = (start: string, end?: string | null) => {
  const from = new Date(start); const to = end ? new Date(end) : new Date();
  const months = Math.max(0, (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth());
  const years = Math.floor(months / 12); const remainder = months % 12;
  return [years ? `${years} yr${years === 1 ? "" : "s"}` : "", remainder ? `${remainder} mo${remainder === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ") || "Less than a month";
};

export default function CandidateProfileView() {
  const params = useParams<{ id: string }>(); const router = useRouter();
  const [candidate, setCandidate] = useState<CandidateProfile | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(""); const [notice, setNotice] = useState("");
  const [contacts, setContacts] = useState<{ email?: string | null; phone?: string | null } | null>(null);
  const [comment, setComment] = useState(""); const [activity, setActivity] = useState<any[] | null>(null); const [emailOpen, setEmailOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("Opportunity from Jobinfo India"); const [emailBody, setEmailBody] = useState("Hello,\n\nI would like to discuss a relevant opportunity with you. Please let me know if you are interested.\n\nRegards,");
  const resumeSection = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    api<{ candidate: CandidateProfile }>(`/api/v1/recruiters/candidates/${encodeURIComponent(params.id)}`).then(result => {
      if (!active) return;
      if (result.ok) setCandidate(result.data.candidate); else setError(result.data.error || "Could not load candidate profile");
    });
    return () => { active = false; };
  }, [params.id]);

  const verified = Boolean(candidate?.user.emailVerifiedAt && candidate.user.phoneVerifiedAt);
  const lastAiMatch = candidate?.aiMatches?.[0];
  const backToSearch = () => {
    let cameFromSearch = false;
    try { cameFromSearch = Boolean(sessionStorage.getItem("candidateSearchRestore")); } catch { /* Use a normal route fallback. */ }
    if (cameFromSearch) router.back(); else router.push("/recruiter/candidates");
  };
  const updateStatus = async (status: "SHORTLISTED" | "REJECTED") => {
    setBusy("status"); setError("");
    const result = await api<any>(`/api/v1/recruiters/candidates/${encodeURIComponent(params.id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    setBusy("");
    if (!result.ok) setError(result.data.error || "Could not update candidate status");
    else { setCandidate(current => current ? { ...current, recruiterStatus: status } : current); setNotice(status === "SHORTLISTED" ? "Candidate shortlisted." : "Candidate marked rejected."); }
  };
  const revealContact = async () => {
    setBusy("contact"); setError("");
    const result = await api<{ email?: string | null; phone?: string | null }>(`/api/v1/recruiters/candidates/${encodeURIComponent(params.id)}/contact`);
    setBusy("");
    if (!result.ok) setError(result.data.error || "Verified contact details are unavailable"); else { setContacts(result.data); setCandidate(current => current ? { ...current, recruiterStatus: "CONTACTED" } : current); setNotice("Authorized contact access recorded."); }
  };
  const saveComment = async (event: FormEvent) => {
    event.preventDefault(); if (!comment.trim()) return;
    setBusy("comment"); setError("");
    const result = await api<any>(`/api/v1/recruiters/candidates/${encodeURIComponent(params.id)}/comments`, { method: "POST", body: JSON.stringify({ body: comment }) });
    setBusy("");
    if (!result.ok) setError(result.data.error || "Could not save comment"); else { setCandidate(current => current ? { ...current, recruiterComments: [result.data.comment, ...current.recruiterComments] } : current); setComment(""); setNotice("Private recruiter note saved."); }
  };
  const loadActivity = async () => {
    if (activity) { setActivity(null); return; }
    setBusy("activity"); setError("");
    const result = await api<{ data: any[] }>(`/api/v1/recruiters/candidates/${encodeURIComponent(params.id)}/activity`);
    setBusy(""); if (!result.ok) setError(result.data.error || "Could not load activity history"); else setActivity(result.data.data);
  };
  const sendEmail = async (event: FormEvent) => {
    event.preventDefault(); setBusy("email"); setError("");
    const result = await api<any>(`/api/v1/recruiters/candidates/${encodeURIComponent(params.id)}/email`, { method: "POST", body: JSON.stringify({ subject: emailSubject, body: emailBody }) });
    setBusy(""); if (!result.ok) setError(result.data.error || "Could not send email"); else { setEmailOpen(false); setCandidate(current => current ? { ...current, recruiterStatus: "CONTACTED" } : current); setNotice("Email sent to candidate."); }
  };
  const skills = useMemo(() => candidate?.skills || [], [candidate?.skills]);

  return <Page><main className="wrap section candidateDetailPage">
    <button type="button" className="candidateBackButton" onClick={backToSearch}>← Back to Candidate Search</button>
    {error && <div className="err" role="alert">{error}</div>}{notice && <div className="info" role="status">{notice}</div>}
    {!candidate && !error && <div className="card candidateDetailLoading">Loading candidate profile…</div>}
    {candidate && <>
      <div className="candidateDetailLayout">
        <div className="candidateDetailMain">
          <section className="card candidateDetailHero">
            <div className="candidateDetailIdentity">
              <div className="candidateDetailAvatar">{candidate.hasPhoto ? <img src={`/api/v1/recruiters/candidates/${encodeURIComponent(candidate.id)}/photo`} alt="Candidate profile" /> : candidate.user.fullName.slice(0, 1).toUpperCase()}</div>
              <div className="candidateDetailName"><p className="eyebrow">CANDIDATE PROFILE</p><h1>{candidate.user.fullName}</h1><h2>{candidate.currentDesignation || candidate.headline || "Professional profile"}{candidate.currentCompany ? ` · ${candidate.currentCompany}` : ""}</h2><p className="muted">{[candidate.city, candidate.state].filter(Boolean).join(", ") || "Location not provided"} · {candidate.experienceYears === 0 ? "Fresher" : candidate.experienceYears == null ? "Experience not provided" : `${candidate.experienceYears} years experience`}</p><div className="candidateDetailBadges">{verified && <span className="candidateVerified">Verified contact</span>}<span className="candidateDetailStatus">{candidate.recruiterStatus}</span></div></div>
            </div>
            <div className="candidateDetailStats"><div><small>Profile completion</small><b>{candidate.profileCompletionPercentage}%</b><span className="candidateProgress"><i style={{ width: `${candidate.profileCompletionPercentage}%` }} /></span></div><div><small>Current CTC</small><b>{money(candidate.currentSalary)}</b></div><div><small>Expected CTC</small><b>{money(candidate.expectedSalary)}</b></div><div><small>Last active</small><b>{dateLabel(candidate.user.lastActiveAt)}</b></div></div>
            <div className="candidateUpdatedLine">Profile updated {dateLabel(candidate.updatedAt)}</div>
          </section>

          <section className="card candidateDetailSection"><h2>Personal information</h2><div className="candidateInfoGrid"><div><small>Full name</small><b>{candidate.user.fullName}</b></div><div><small>Email</small><b>{contacts?.email || (verified ? "Verified · reveal to view" : "Not verified")}</b></div><div><small>Mobile</small><b>{contacts?.phone || (verified ? "Verified · reveal to view" : "Not verified")}</b></div><div><small>Date of birth</small><b>{candidate.dateOfBirth ? dateLabel(candidate.dateOfBirth) : "Restricted or not provided"}</b></div><div><small>Gender</small><b>{candidate.gender || "Restricted or not provided"}</b></div><div><small>Current location</small><b>{[candidate.city, candidate.state].filter(Boolean).join(", ") || "Not provided"}</b></div></div></section>

          <section className="card candidateDetailSection"><h2>Professional profile</h2>{candidate.headline && <h3>{candidate.headline}</h3>}{candidate.summary && <div className="candidateTextBlock"><h3>Professional summary</h3><p>{candidate.summary}</p></div>}{candidate.careerObjective && <div className="candidateTextBlock"><h3>Career objective</h3><p>{candidate.careerObjective}</p></div>}<p className="muted">Total professional experience: {candidate.experienceYears === 0 ? "Fresher" : candidate.experienceYears == null ? "Not specified" : `${candidate.experienceYears} years`}</p><h3>Skills</h3>{skills.length ? <div className="tags">{skills.map((skill,index)=><span className="tag" key={`${skill.name}-${index}`}>{skill.name}</span>)}</div> : <p className="muted">No skills listed.</p>}</section>

          <section className="card candidateDetailSection"><h2>Current employment</h2><div className="candidateInfoGrid"><div><small>Company</small><b>{candidate.currentCompany || "Not provided"}</b></div><div><small>Designation</small><b>{candidate.currentDesignation || "Not provided"}</b></div><div><small>Current annual CTC</small><b>{money(candidate.currentSalary)}</b></div><div><small>Notice period</small><b>{candidate.noticePeriod || "Not provided"}</b></div><div><small>Employment type</small><b>{candidate.employmentType || "Not provided"}</b></div><div><small>Industry</small><b>{candidate.currentIndustry || "Not provided"}</b></div></div></section>

          <section className="card candidateDetailSection"><h2>Employment history</h2>{candidate.workExperience.length ? candidate.workExperience.map((job:any)=><article className="candidateTimelineItem" key={job.id}><div className="candidateTimelineMarker"/><div><h3>{job.title || "Role"} · {job.company}</h3><p className="muted">{dateLabel(job.startDate)} – {job.current ? "Present" : dateLabel(job.endDate)} · {duration(job.startDate,job.current?undefined:job.endDate)}</p>{job.location && <p>{job.location}</p>}{job.employmentType && <p>{job.employmentType}</p>}{job.description && <p className="candidateLongText">{job.description}</p>}</div></article>) : <p className="muted">No employment history has been added.</p>}</section>

          <section className="card candidateDetailSection"><h2>Education</h2>{candidate.education.length ? candidate.education.map((item:any)=><article className="candidateEducationItem" key={item.id}><h3>{item.degree}{item.field ? ` · ${item.field}` : ""}</h3><p>{item.institution}{item.university ? ` · ${item.university}` : ""}</p><div className="muted">{[item.department,item.passingYear,item.grade].filter(Boolean).join(" · ") || "Details not provided"}</div></article>) : <p className="muted">No education records have been added.</p>}</section>

          <section className="card candidateDetailSection"><h2>Certifications, training & languages</h2><div className="candidateSubsection"><h3>Certifications</h3>{candidate.certifications.length ? candidate.certifications.map((item:any)=><p key={item.id}><b>{item.name}</b>{item.issuer ? ` · ${item.issuer}` : ""}{item.issueYear ? ` · ${item.issueYear}` : ""}{item.credentialUrl && <> · <a href={item.credentialUrl} target="_blank" rel="noreferrer">Credential</a></>}</p>) : <p className="muted">No certifications listed.</p>}</div><div className="candidateSubsection"><h3>Training</h3>{candidate.trainings.length ? candidate.trainings.map((item:any)=><p key={item.id}><b>{item.name}</b>{item.provider ? ` · ${item.provider}` : ""}{item.completionYear ? ` · ${item.completionYear}` : ""}{item.details ? <span className="candidateLongText">{item.details}</span> : null}</p>) : <p className="muted">No training listed.</p>}</div><div className="candidateSubsection"><h3>Languages</h3>{candidate.languages.length ? <div className="tags">{candidate.languages.map(language=><span className="tag" key={language}>{language}</span>)}</div> : <p className="muted">No languages listed.</p>}</div></section>

          <section className="card candidateDetailSection"><h2>Job preferences</h2><div className="candidateInfoGrid"><div><small>Expected CTC</small><b>{money(candidate.expectedSalary)}</b></div><div><small>Preferred roles</small><b>{candidate.preferredJobRoles.join(", ") || "Not provided"}</b></div><div><small>Preferred locations</small><b>{candidate.preferredJobLocations.join(", ") || "Not provided"}</b></div><div><small>Work type</small><b>{candidate.workMode || "Not provided"}</b></div><div><small>Employment type</small><b>{candidate.employmentType || "Not provided"}</b></div><div><small>Preferred shift</small><b>{candidate.preferredShift || "Not provided"}</b></div><div><small>Joining availability</small><b>{candidate.noticePeriod || "Not provided"}</b></div></div>{candidate.linkedinUrl && <p className="candidateExternalLink"><a href={candidate.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn profile</a></p>}{candidate.portfolioUrl && <p className="candidateExternalLink"><a href={candidate.portfolioUrl} target="_blank" rel="noreferrer">Portfolio</a></p>}</section>
        </div>

        <aside className="candidateRecruiterPanel card"><p className="eyebrow">RECRUITER ACTIONS</p><h2>Candidate actions</h2><button type="button" className="btn candidateActionPrimary" disabled={busy==="status"||candidate.recruiterStatus==="SHORTLISTED"} onClick={()=>void updateStatus("SHORTLISTED")}>{candidate.recruiterStatus==="SHORTLISTED"?"✓ Shortlisted":"Shortlist candidate"}</button><button type="button" className="btn outline danger" disabled={busy==="status"||candidate.recruiterStatus==="REJECTED"} onClick={()=>void updateStatus("REJECTED")}>{candidate.recruiterStatus==="REJECTED"?"Rejected":"Reject candidate"}</button><button type="button" className="btn outline" disabled={busy==="contact"} onClick={()=>void revealContact()}>{busy==="contact"?"Loading contact…":"Contact candidate"}</button>{contacts?.phone&&<a className="candidateContactLink" href={`tel:${contacts.phone}`}>Call {contacts.phone}</a>}{contacts?.email&&<a className="candidateContactLink" href={`mailto:${contacts.email}`}>{contacts.email}</a>}<button type="button" className="btn outline" onClick={()=>setEmailOpen(true)}>Send email</button><button type="button" className="btn outline" disabled={!candidate.hasResume} onClick={()=>resumeSection.current?.scrollIntoView({behavior:"smooth",block:"start"})}>View resume</button><a className={`btn outline${!candidate.hasResume?" isDisabled":""}`} aria-disabled={!candidate.hasResume} onClick={event=>{if(!candidate.hasResume)event.preventDefault();}} href={`/api/v1/recruiters/candidates/${encodeURIComponent(candidate.id)}/resume`}>Download resume</a>
          <form className="candidateCommentForm" onSubmit={saveComment}><label htmlFor="candidate-detail-comment">Private recruiter note</label><textarea id="candidate-detail-comment" rows={3} maxLength={3000} value={comment} onChange={event=>setComment(event.target.value)} placeholder="Add a note about this candidate"/><button className="btn outline sm" disabled={!comment.trim()||busy==="comment"}>{busy==="comment"?"Saving…":"Add comment"}</button></form>
          <button type="button" className="btn outline" disabled={busy==="activity"} onClick={()=>void loadActivity()}>{busy==="activity"?"Loading activity…":activity?"Hide activity history":"View activity history"}</button>
          {activity && <div className="candidateActivityList">{activity.length ? activity.map(item=><article key={item.id}><b>{String(item.type).replaceAll("_"," ").toLowerCase()}</b><time>{new Date(item.createdAt).toLocaleString()}</time>{item.details?.body&&<p>{item.details.body}</p>}</article>) : <p className="muted">No activity recorded yet.</p>}</div>}
          {candidate.recruiterComments.length>0&&<div className="candidateSavedNotes"><h3>Your notes</h3>{candidate.recruiterComments.map(item=><p key={item.id}>{item.body}<small>{new Date(item.createdAt).toLocaleString()}</small></p>)}</div>}
        </aside>

        {lastAiMatch && <section className="card candidateAiMatchPanel"><p className="eyebrow">SAVED AI RECOMMENDATION · {dateLabel(lastAiMatch.createdAt)}</p><h2>Job match: {lastAiMatch.match.matchScore}%</h2><p>{lastAiMatch.match.recommendation}</p><div className="candidateMatchColumns"><div><h3>Matched skills</h3><div className="tags">{(lastAiMatch.match.matchedRequiredSkills || []).concat(lastAiMatch.match.matchedPreferredSkills || []).map((skill:string)=><span className="tag" key={skill}>{skill} ✓</span>)}</div></div><div><h3>Skills to review</h3><div className="tags">{(lastAiMatch.match.missingSkills || []).map((skill:string)=><span className="tag candidateMissingSkill" key={skill}>{skill}</span>)}</div></div><div><h3>Experience requirement</h3><p>{lastAiMatch.criteria?.minExperience ?? "Not specified"}–{lastAiMatch.criteria?.maxExperience ?? "Not specified"} years required · Candidate: {candidate.experienceYears ?? "Not provided"} years</p></div></div><p className="muted">Recommendation reasons: {lastAiMatch.match.recommendation}; skill match {lastAiMatch.match.scoreDetails?.skillScore ?? "—"}%, experience match {lastAiMatch.match.scoreDetails?.expScore ?? "—"}%, education match {lastAiMatch.match.scoreDetails?.eduScore ?? "—"}%.</p><small>AI assisted decision support. Review candidate evidence directly.</small></section>}

        <section className="candidateDetailResume" ref={resumeSection as any}><ResumeViewer candidateId={candidate.id}/></section>
      </div>
    </>}

    {emailOpen&&<div className="candidateModalBackdrop" role="presentation" onClick={()=>setEmailOpen(false)}><section className="card candidateModal" role="dialog" aria-modal="true" aria-labelledby="candidate-email-heading" onClick={event=>event.stopPropagation()}><button className="candidateModalClose" type="button" onClick={()=>setEmailOpen(false)}>×</button><h2 id="candidate-email-heading">Email candidate</h2><p className="muted">The candidate must have a verified email and must have shared their profile or applied to your company.</p><form onSubmit={sendEmail}><label className="field">Subject<input value={emailSubject} maxLength={150} required onChange={event=>setEmailSubject(event.target.value)}/></label><label className="field">Message<textarea rows={8} maxLength={10000} required value={emailBody} onChange={event=>setEmailBody(event.target.value)}/></label><div className="managedJobActions"><button className="btn" disabled={busy==="email"}>{busy==="email"?"Sending…":"Send email"}</button><button className="btn outline" type="button" onClick={()=>setEmailOpen(false)}>Cancel</button></div></form></section></div>}
  </main></Page>;
}
