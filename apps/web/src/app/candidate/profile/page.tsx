"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { API, api } from "@/lib/api";

type Education = { institution: string; degree: string; field: string; department: string; passingYear: string };
type Certification = { name: string; issuer: string; issueYear: string; credentialUrl: string };
type Experience = { company: string; title: string; location: string; description: string; startDate: string; endDate: string; current: boolean };
const emptyEducation: Education = { institution: "", degree: "", field: "", department: "", passingYear: "" };
const emptyCertification: Certification = { name: "", issuer: "", issueYear: "", credentialUrl: "" };
const emptyExperience: Experience = { company: "", title: "", location: "", description: "", startDate: "", endDate: "", current: false };

function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read selected file"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.readAsDataURL(file);
  });
}

export default function CandidateProfile() {
  const [profile, setProfile] = useState<any>(null);
  const [fullName, setFullName] = useState("");
  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [experienceYears, setExperienceYears] = useState("");
  const [skills, setSkills] = useState("");
  const [education, setEducation] = useState<Education[]>([{ ...emptyEducation }]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [experience, setExperience] = useState<Experience[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");

  useEffect(() => {
    api<{ candidate: any }>("/api/v1/candidates/me").then((r) => {
      if (!r.ok) { setError(r.data.error || "Please sign in as a candidate."); return; }
      const c = r.data.candidate;
      setProfile(c); setFullName(c.user?.fullName || ""); setHeadline(c.headline || ""); setSummary(c.summary || ""); setCity(c.city || ""); setState(c.state || "");
      setExperienceYears(c.experienceYears == null ? "" : String(c.experienceYears));
      setSkills((c.skills || []).map((x: any) => x.name).join(", "));
      setEducation(c.education?.length ? c.education.map((x: any) => ({ institution: x.institution, degree: x.degree, field: x.field || "", department: x.department || "", passingYear: x.passingYear ? String(x.passingYear) : "" })) : [{ ...emptyEducation }]);
      setCertifications((c.certifications || []).map((x: any) => ({ name: x.name, issuer: x.issuer || "", issueYear: x.issueYear ? String(x.issueYear) : "", credentialUrl: x.credentialUrl || "" })));
      setExperience((c.workExperience || []).map((x: any) => ({ company: x.company, title: x.title, location: x.location || "", description: x.description || "", startDate: x.startDate.slice(0, 10), endDate: x.endDate?.slice(0, 10) || "", current: x.current })));
    });
  }, []);

  useEffect(() => {
    if (!profile?.hasProfilePhoto) return;
    const controller = new AbortController();
    let objectUrl = "";
    fetch(`${API}/api/v1/candidates/me/photo`, { credentials: "include", signal: controller.signal })
      .then((r) => r.ok ? r.blob() : Promise.reject())
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setPhotoUrl(objectUrl); })
      .catch(() => undefined);
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [profile?.hasProfilePhoto]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const r = await api("/api/v1/candidates/me", { method: "PUT", body: JSON.stringify({
      fullName, headline, summary, city, state, searchable: profile.searchable, experienceYears: experienceYears === "" ? undefined : Number(experienceYears),
      skills: skills.split(",").map((x) => x.trim()).filter(Boolean),
      education: education.filter((x) => x.institution.trim() && x.degree.trim()).map((x) => ({ ...x, passingYear: x.passingYear ? Number(x.passingYear) : undefined, field: x.field || undefined, department: x.department || undefined })),
      certifications: certifications.filter((x) => x.name.trim()).map((x) => ({ ...x, issueYear: x.issueYear ? Number(x.issueYear) : undefined, issuer: x.issuer || undefined, credentialUrl: x.credentialUrl || undefined })),
      workExperience: experience.filter((x) => x.company.trim() && x.title.trim() && x.startDate).map((x) => ({ ...x, location: x.location || undefined, description: x.description || undefined, endDate: x.current ? undefined : x.endDate || undefined })),
    }) });
    setBusy(false);
    if (!r.ok) setError(r.data.error || "Could not save profile"); else setMessage("Profile saved.");
  };

  const upload = async (file: File | undefined, kind: "resume" | "photo") => {
    if (!file) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await api(`/api/v1/candidates/me/${kind}`, { method: "PUT", body: JSON.stringify({ fileName: file.name, contentType: file.type, data: await base64(file) }) });
      if (!r.ok) setError(r.data.error || `Could not upload ${kind}`);
      else { setMessage(kind === "resume" ? "Resume uploaded." : "Profile photo uploaded."); setProfile((p: any) => ({ ...p, hasResume: kind === "resume" ? true : p.hasResume, hasProfilePhoto: kind === "photo" ? true : p.hasProfilePhoto })); if (kind === "photo") { if (photoUrl) URL.revokeObjectURL(photoUrl); setPhotoUrl(URL.createObjectURL(file)); } }
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    setBusy(false);
  };

  const downloadResume = async () => {
    const response = await fetch(`${API}/api/v1/candidates/me/resume`, { credentials: "include" });
    if (!response.ok) { setError("Could not download resume."); return; }
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a");
    link.href = url; link.download = "resume"; link.click(); URL.revokeObjectURL(url);
  };

  const removeFile = async (kind: "resume" | "photo") => {
    const r = await api(`/api/v1/candidates/me/${kind}`, { method: "DELETE" });
    if (!r.ok) setError(r.data.error || `Could not remove ${kind}`);
    else { setProfile((p: any) => ({ ...p, hasResume: kind === "resume" ? false : p.hasResume, hasProfilePhoto: kind === "photo" ? false : p.hasProfilePhoto })); if (kind === "photo") setPhotoUrl(""); setMessage(`${kind === "resume" ? "Resume" : "Photo"} removed.`); }
  };

  const updateRow = <T,>(rows: T[], setRows: (rows: T[]) => void, index: number, value: Partial<T>) => setRows(rows.map((row, i) => i === index ? { ...row, ...value } : row));

  return <Page><main className="wrap section candidateProfile">
    <div className="row2 profileHeading"><div><p className="eyebrow">CANDIDATE WORKSPACE</p><h1>My profile</h1><p className="muted">Build a profile recruiters can understand at a glance.</p></div><Link className="btn outline" href="/candidate/dashboard">Dashboard</Link></div>
    {error && <div className="err">{error} <Link href="/login">Sign in</Link></div>}{message && <div className="info">{message}</div>}
    {!profile ? <div className="card">Loading your profile…</div> : <>
      <section className="card profileFiles"><div><h2>Profile photo</h2><p className="muted">JPG, PNG or WEBP, up to 2 MB.</p>
        {photoUrl && <><img className="profilePhoto" src={photoUrl} alt="Your profile" /><a className="linkBtn" href={`${API}/api/v1/candidates/me/photo`} download>Download photo</a></>}
        <label className="fileControl">{profile.hasProfilePhoto ? "Change photo" : "Upload photo"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => upload(e.target.files?.[0], "photo")} /></label>
        {profile.hasProfilePhoto && <button className="linkBtn" type="button" onClick={() => removeFile("photo")}>Remove photo</button>}
      </div><div><h2>Resume</h2><p className="muted">PDF, DOC or DOCX, up to 5 MB. Only you can download your resume from this page.</p>
        <label className="fileControl">{profile.hasResume ? "Replace resume" : "Upload resume"}<input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => upload(e.target.files?.[0], "resume")} /></label>
        {profile.hasResume && <><button className="linkBtn" type="button" onClick={downloadResume}>Download resume</button><button className="linkBtn" type="button" onClick={() => removeFile("resume")}>Remove resume</button></>}
      </div></section>
      <form className="profileForm" onSubmit={save}>
        <section className="card"><h2>Personal information</h2>
          <p className="verificationState">Mobile {profile.user?.phoneVerifiedAt ? "verified" : "not verified"} · Email {profile.user?.emailVerifiedAt ? "verified" : "not verified"}</p>
          <label className="field">Full name<input value={fullName} maxLength={100} onChange={(e) => setFullName(e.target.value)} /></label>
          <div className="row2"><label className="field">Email address<input value={profile.user?.email || ""} readOnly /></label><label className="field">Mobile number<input value={profile.user?.phone || ""} readOnly /></label></div>
          <label className="field">Professional headline<input value={headline} maxLength={120} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Frontend engineer specializing in React" /></label>
          <label className="field">About you<textarea value={summary} maxLength={2000} rows={4} onChange={(e) => setSummary(e.target.value)} /></label>
          <div className="row2"><label className="field">City<input value={city} onChange={(e) => setCity(e.target.value)} /></label><label className="field">State<input value={state} onChange={(e) => setState(e.target.value)} /></label></div>
          <label className="field">Years of experience (0 = fresher)<input type="number" min={0} max={50} value={experienceYears} onChange={(e) => setExperienceYears(e.target.value)} /></label>
          <label className="field">Skills, separated by commas<input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="React, TypeScript, SQL" /></label>
          <label className="check"><input type="checkbox" checked={profile.searchable} onChange={(e) => setProfile((p: any) => ({ ...p, searchable: e.target.checked }))} /> Allow recruiters to discover my profile in candidate search</label>
        </section>
        <section className="card"><div className="sectionTitle"><h2>Education</h2><button className="btn outline sm" type="button" onClick={() => setEducation([...education, { ...emptyEducation }])}>Add education</button></div>
          {education.map((x, i) => <div className="repeatBlock" key={i}><button type="button" className="removeRow" onClick={() => setEducation(education.filter((_, n) => n !== i))} aria-label="Remove education">Remove</button>
            <div className="row2"><label className="field">Institution<input value={x.institution} onChange={(e) => updateRow(education, setEducation, i, { institution: e.target.value })} /></label><label className="field">Degree<input value={x.degree} onChange={(e) => updateRow(education, setEducation, i, { degree: e.target.value })} /></label></div>
            <div className="row2"><label className="field">Field of study<input value={x.field} onChange={(e) => updateRow(education, setEducation, i, { field: e.target.value })} /></label><label className="field">Passing year<input type="number" min={1970} max={2100} value={x.passingYear} onChange={(e) => updateRow(education, setEducation, i, { passingYear: e.target.value })} /></label></div>
            <label className="field">Department<input value={x.department} onChange={(e) => updateRow(education, setEducation, i, { department: e.target.value })} placeholder="e.g. Computer Science" /></label>
          </div>)}
        </section>
        <section className="card"><div className="sectionTitle"><h2>Certifications</h2><button className="btn outline sm" type="button" onClick={() => setCertifications([...certifications, { ...emptyCertification }])}>Add certification</button></div>
          {certifications.map((x, i) => <div className="repeatBlock" key={i}><button type="button" className="removeRow" onClick={() => setCertifications(certifications.filter((_, n) => n !== i))}>Remove</button>
            <div className="row2"><label className="field">Certification<input value={x.name} onChange={(e) => updateRow(certifications, setCertifications, i, { name: e.target.value })} /></label><label className="field">Issuer<input value={x.issuer} onChange={(e) => updateRow(certifications, setCertifications, i, { issuer: e.target.value })} /></label></div>
            <div className="row2"><label className="field">Issue year<input type="number" min={1970} max={2100} value={x.issueYear} onChange={(e) => updateRow(certifications, setCertifications, i, { issueYear: e.target.value })} /></label><label className="field">Credential URL<input type="url" value={x.credentialUrl} onChange={(e) => updateRow(certifications, setCertifications, i, { credentialUrl: e.target.value })} /></label></div>
          </div>)}
        </section>
        <section className="card"><div className="sectionTitle"><h2>Work experience</h2><button className="btn outline sm" type="button" onClick={() => setExperience([...experience, { ...emptyExperience }])}>Add experience</button></div>
          {experience.map((x, i) => <div className="repeatBlock" key={i}><button type="button" className="removeRow" onClick={() => setExperience(experience.filter((_, n) => n !== i))}>Remove</button>
            <div className="row2"><label className="field">Job title<input value={x.title} onChange={(e) => updateRow(experience, setExperience, i, { title: e.target.value })} /></label><label className="field">Company<input value={x.company} onChange={(e) => updateRow(experience, setExperience, i, { company: e.target.value })} /></label></div>
            <label className="field">Location<input value={x.location} onChange={(e) => updateRow(experience, setExperience, i, { location: e.target.value })} /></label>
            <div className="row2"><label className="field">Start date<input type="date" value={x.startDate} onChange={(e) => updateRow(experience, setExperience, i, { startDate: e.target.value })} /></label><label className="field">End date<input type="date" disabled={x.current} value={x.endDate} onChange={(e) => updateRow(experience, setExperience, i, { endDate: e.target.value })} /></label></div>
            <label className="check"><input type="checkbox" checked={x.current} onChange={(e) => updateRow(experience, setExperience, i, { current: e.target.checked })} /> I currently work here</label>
            <label className="field">Description<textarea rows={3} value={x.description} onChange={(e) => updateRow(experience, setExperience, i, { description: e.target.value })} /></label>
          </div>)}
        </section>
        <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
      </form>
    </>}
  </main></Page>;
}
