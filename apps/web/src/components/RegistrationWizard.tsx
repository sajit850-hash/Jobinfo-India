"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

type RegistrationKind = "candidate" | "recruiter" | "institution";
type RecordRow = Record<string, string>;
type Draft = Record<string, unknown>;

const stages = ["Account", "Profile", "Done"];
const dashboard: Record<RegistrationKind, string> = {
  candidate: "/candidate/dashboard",
  recruiter: "/recruiter/dashboard",
  institution: "/institution/dashboard",
};
const recordFields: Record<RegistrationKind, { key: string; title: string; fields: [string, string, string][] }[]> = {
  candidate: [
    { key: "education", title: "Education", fields: [["institution", "College / university", "text"], ["degree", "Qualification / degree", "text"], ["field", "Course / specialization", "text"], ["passingYear", "Passing year", "number"], ["grade", "Grade / percentage", "text"]] },
    { key: "workExperience", title: "Experience", fields: [["company", "Company name", "text"], ["title", "Designation", "text"], ["employmentType", "Employment type", "text"], ["startDate", "Start date", "date"], ["endDate", "End date", "date"], ["location", "Location", "text"], ["description", "Responsibilities", "text"]] },
    { key: "certifications", title: "Certifications", fields: [["name", "Certification name", "text"], ["issuer", "Issuing organization", "text"], ["issueDate", "Issue date", "date"], ["expiryDate", "Expiry date", "date"], ["credentialUrl", "Certification URL", "url"]] },
  ],
  recruiter: [],
  institution: [],
};

const profileFields: Record<RegistrationKind, [string, string, string][]> = {
  candidate: [
    ["dateOfBirth", "Date of birth", "date"], ["gender", "Gender", "select:Woman|Man|Non-binary|Prefer not to say|Other"],
    ["headline", "Professional headline", "text"], ["city", "Current city", "text"], ["state", "Current state", "text"],
    ["currentAddress", "Current address", "text"], ["postalCode", "PIN code", "text"], ["country", "Country", "text"],
    ["highestQualification", "Highest qualification", "text"], ["course", "Course / specialization", "text"], ["grade", "Grade / percentage", "text"],
    ["experienceYears", "Experience in years (0 for fresher)", "number"], ["expectedSalary", "Expected annual salary (INR)", "number"],
    ["skills", "Skills (comma separated)", "text"], ["preferredJobLocations", "Preferred job locations (comma separated)", "text"],
    ["employmentType", "Preferred employment type", "select:Full-time|Part-time|Contract|Internship|Freelance"],
    ["workMode", "Preferred work mode", "select:On-site|Hybrid|Remote"], ["preferredJobRoles", "Preferred job roles (comma separated)", "text"],
    ["noticePeriod", "Notice period", "text"], ["languages", "Languages (comma separated)", "text"],
    ["linkedinUrl", "LinkedIn profile", "url"], ["portfolioUrl", "Portfolio URL", "url"], ["summary", "Profile summary", "textarea"],
  ],
  recruiter: [
    ["recruiterDesignation", "Your designation", "text"], ["recruiterDepartment", "Your department", "text"], ["recruiterLinkedinUrl", "Your LinkedIn profile", "url"],
    ["name", "Company / recruiter name", "text"], ["website", "Company website", "url"], ["industry", "Industry", "text"],
    ["companySize", "Company size", "select:1-10|11-50|51-200|201-500|501-1000|1000+"],
    ["description", "Company description", "textarea"], ["registeredAddress", "Registered address", "text"],
    ["city", "City", "text"], ["state", "State", "text"], ["postalCode", "PIN code", "text"], ["country", "Country", "text"],
    ["gstin", "GSTIN (optional)", "text"], ["companyLinkedinUrl", "Company LinkedIn URL", "url"],
    ["hiringDepartments", "Hiring departments (comma separated)", "text"], ["hiringLocations", "Hiring locations (comma separated)", "text"],
    ["hiringVolume", "Expected annual hiring volume", "number"], ["positionTypes", "Types of positions (comma separated)", "text"],
    ["recruitmentRequirements", "Recruitment requirements", "textarea"],
    ["professionalExperienceYears", "Recruiting experience (years)", "number"], ["specialization", "Recruitment specialization", "text"],
    ["preferredHiringCategories", "Preferred hiring categories (comma separated)", "text"],
  ],
  institution: [
    ["institutionType", "Institution type", "select:University|College|School|Training institute|Other"],
    ["category", "Institution category", "text"], ["establishedYear", "Establishment year", "number"],
    ["affiliation", "University / affiliation", "text"], ["accreditation", "Accreditation", "text"],
    ["registrationNumber", "Registration number", "text"], ["website", "Institution website", "url"],
    ["description", "Institution description", "textarea"], ["contactDesignation", "Contact person designation", "text"],
    ["address", "Complete address", "text"], ["city", "City", "text"], ["state", "State", "text"],
    ["postalCode", "PIN code", "text"], ["country", "Country", "text"],     ["studentStrength", "Total student strength", "number"],
    ["placementOfficerName", "Placement officer name", "text"], ["placementOfficerDesignation", "Placement officer designation", "text"],
    ["placementOfficerEmail", "Placement officer email", "email"], ["placementOfficerPhone", "Placement officer mobile", "tel"],
  ],
};

const emptyValues = (): Record<string, string> => ({
  country: "India",
  experienceYears: "0",
  employmentType: "Full-time",
  workMode: "On-site",
});

function splitList(value: string) {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function makeRow(fields: [string, string, string][]): RecordRow {
  return Object.fromEntries(fields.map(([key]) => [key, ""]));
}

function encodeFile(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
    }
    return btoa(binary);
  });
}

export function RegistrationWizard({ kind }: { kind: RegistrationKind }) {
  const router = useRouter();
  const [stage, setStage] = useState(1);
  const [values, setValues] = useState<Record<string, string>>(emptyValues);
  const [rows, setRows] = useState<Record<string, RecordRow[]>>(() =>
    Object.fromEntries(recordFields[kind].map(({ key, fields }) => [key, [makeRow(fields)]])),
  );
  const [listEntries, setListEntries] = useState<Record<string, string[]>>({ departments: [""], courses: [""], passingYears: [""] });
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [accountCreated, setAccountCreated] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const storageKey = `jobinfo-registration-${kind}`;
  const listKeys = useMemo(() => new Set(
    kind === "candidate" ? ["skills", "preferredJobLocations", "preferredJobRoles", "languages"]
      : kind === "recruiter" ? ["hiringDepartments", "hiringLocations", "positionTypes", "preferredHiringCategories"]
        : ["departments", "courses", "passingYears"],
  ), [kind]);

  const reportFailure = (text: string) => { setError(text); setMessage(""); };
  const updateValue = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    let active = true;
    sessionStorage.removeItem(storageKey);
    try {
      const accountDraft = sessionStorage.getItem(`${storageKey}-account`);
      if (accountDraft) setValues((current) => ({ ...current, ...JSON.parse(accountDraft) as Record<string, string> }));
    } catch {
      sessionStorage.removeItem(`${storageKey}-account`);
    }
    void api<{ role: string; status: string; draft: Draft | null }>("/api/v1/auth/registration/status").then((result) => {
      if (!active) return;
      if (!result.ok || result.data.role !== ({ candidate: "CANDIDATE", recruiter: "RECRUITER", institution: "INSTITUTION" } as const)[kind]) {
        setRestored(true);
        return;
      }
      setAccountCreated(true);
      sessionStorage.removeItem(`${storageKey}-account`);
      const draft = result.data.draft ?? {};
      setValues((current) => ({ ...current, ...Object.fromEntries(
        Object.entries(draft).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ) }));
      const restoredRows = Object.fromEntries(recordFields[kind].map(({ key, fields }) => [
        key,
        Array.isArray(draft[key]) && draft[key].length
          ? draft[key] as RecordRow[]
          : [makeRow(fields)],
      ]));
      setRows(restoredRows);
      setListEntries((current) => Object.fromEntries(["departments", "courses", "passingYears"].map((key) => [
        key,
        Array.isArray(draft[key]) && draft[key].length ? (draft[key] as unknown[]).map(String) : current[key],
      ])));
      setStage(result.data.status === "REGISTRATION_COMPLETED" ? 3 : 2);
      setRestored(true);
    });
    return () => { active = false; };
  }, [kind, storageKey]);

  useEffect(() => {
    if (!restored || accountCreated || stage !== 1) return;
    sessionStorage.setItem(`${storageKey}-account`, JSON.stringify(values));
  }, [accountCreated, restored, stage, storageKey, values]);

  useEffect(() => {
    if (!restored || !accountCreated || stage !== 2) return;
    const timer = window.setTimeout(() => {
      const draft = { ...values, ...rows, ...(kind === "institution" ? listEntries : {}), registrationType: kind };
      void api("/api/v1/auth/registration/draft", { method: "PUT", body: JSON.stringify({ draft }) });
    }, 750);
    return () => window.clearTimeout(timer);
  }, [accountCreated, kind, listEntries, restored, rows, stage, values]);

  useEffect(() => {
    if (stage !== 3) return;
    const timer = window.setTimeout(() => router.replace(dashboard[kind]), 1500);
    return () => window.clearTimeout(timer);
  }, [kind, router, stage]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try { await action(); } catch { reportFailure("Something went wrong. Please try again."); }
    finally { setBusy(false); }
  };

  const createAccount = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (accountCreated) {
      setStage(2);
      return;
    }
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== data.get("confirmPassword")) return reportFailure("Passwords do not match.");
    if (!data.get("terms")) return reportFailure("Accept the Terms and Privacy Policy to continue.");
    return run(async () => {
      const account = Object.fromEntries(["fullName", "contactName", "name", "email", "phone", "recruiterType", "companyName"].flatMap((key) => {
        const value = data.get(key);
        return value ? [[key, String(value)]] : [];
      }));
      const payload = {
        ...account,
        fullName: account.fullName || account.contactName,
        contactName: account.contactName || account.fullName,
        name: account.name || account.companyName || account.fullName,
        password,
        acceptTerms: true,
        recruiterType: account.recruiterType || "CORPORATE",
      };
      const endpoint = kind === "candidate" ? "/api/v1/auth/register/candidate" : kind === "recruiter" ? "/api/v1/recruiters/register" : "/api/v1/institutions/register";
      const result = await api<{ role: string }>(endpoint, { method: "POST", body: JSON.stringify(payload) });
      if (!result.ok) return reportFailure(result.data.error || "Registration failed.");
      setAccountCreated(true);
      sessionStorage.removeItem(`${storageKey}-account`);
      setValues((current) => ({ ...current, ...account, phone: account.phone || "" }));
      setStage(2);
      setMessage("Your account is ready. Continue to your profile.");
    });
  };

  const updateRow = (group: string, index: number, field: string, value: string) => {
    setRows((current) => ({ ...current, [group]: current[group].map((row, i) => i === index ? { ...row, [field]: value } : row) }));
  };

  const saveProfile = (complete: boolean) => run(async () => {
    const payload: Draft = { ...values, ...rows, ...(kind === "institution" ? listEntries : {}), complete };
    if (kind === "candidate") {
      for (const group of recordFields[kind]) {
        payload[group.key] = (rows[group.key] ?? []).filter((row) => Object.values(row).some((value) => value.trim() !== "")).map((row) => {
          const item: Record<string, unknown> = Object.fromEntries(Object.entries(row).filter(([, value]) => value.trim() !== ""));
          if (item.passingYear) item.passingYear = Number(item.passingYear);
          if (item.current !== undefined) item.current = item.current === "true";
          return item;
        });
      }
    }
    for (const key of listKeys) {
      payload[key] = kind === "institution"
        ? (listEntries[key] ?? []).map((item) => item.trim()).filter(Boolean)
        : splitList(String(values[key] ?? ""));
      if (kind === "institution" && key === "passingYears") payload[key] = (payload[key] as string[]).map(Number).filter(Number.isInteger);
    }
    for (const key of ["experienceYears", "expectedSalary", "hiringVolume", "professionalExperienceYears", "establishedYear", "studentStrength"]) {
      if (values[key]) payload[key] = Number(values[key]);
      else delete payload[key];
    }
    if (kind === "institution") {
      payload.placementOfficer = {
        name: values.placementOfficerName || "",
        designation: values.placementOfficerDesignation || "",
        email: values.placementOfficerEmail || "",
        phone: values.placementOfficerPhone || "",
      };
      delete payload.placementOfficerName;
      delete payload.placementOfficerDesignation;
      delete payload.placementOfficerEmail;
      delete payload.placementOfficerPhone;
    }
    if (kind === "candidate") {
      for (const [fileKey, endpoint] of [["resume", "/api/v1/candidates/me/resume"], ["photo", "/api/v1/candidates/me/photo"]] as const) {
        const file = files[fileKey]?.[0];
        if (!file) continue;
        const upload = await api(endpoint, {
          method: "PUT",
          body: JSON.stringify({ fileName: file.name, contentType: file.type, data: await encodeFile(file) }),
        });
        if (!upload.ok) return reportFailure(upload.data.error || `Could not upload ${fileKey}.`);
      }
    }
    if (kind !== "candidate") {
      for (const [category, selectedFiles] of Object.entries(files)) {
        for (const file of selectedFiles) {
          const upload = await api("/api/v1/profile-files", {
            method: "POST",
            body: JSON.stringify({ category, fileName: file.name, contentType: file.type, data: await encodeFile(file) }),
          });
          if (!upload.ok) return reportFailure(upload.data.error || `Could not upload ${file.name}.`);
        }
      }
    }
    const endpoint = kind === "candidate" ? "/api/v1/candidates/me" : kind === "recruiter" ? "/api/v1/recruiters/me" : "/api/v1/institutions/me";
    const result = await api(endpoint, { method: kind === "candidate" ? "PUT" : "PATCH", body: JSON.stringify(payload) });
    if (!result.ok) return reportFailure(result.data.error || "Could not save your profile.");
    if (!complete) {
      setMessage("Your draft is saved. You can finish your profile from your dashboard.");
      return;
    }
    setStage(3);
    sessionStorage.removeItem(storageKey);
  });

  const title = kind === "candidate" ? "Candidate" : kind === "recruiter" ? "Recruiter / Employer" : "Institution";
  const accountTitle = kind === "institution" ? "Contact person name" : "Full name";
  const emailValue = values.email || "";
  const renderProfileField = ([key, label, type]: [string, string, string]) => {
    const value = values[key] ?? "";
    if (type.startsWith("select:")) {
      return <label className="field" key={key}>{label}<select value={value} onChange={(event) => updateValue(key, event.target.value)}><option value="">Select</option>{type.slice(7).split("|").map((option) => <option key={option}>{option}</option>)}</select></label>;
    }
    return <label className="field" key={key}>{label}{type === "textarea"
      ? <textarea value={value} onChange={(event) => updateValue(key, event.target.value)} />
      : <input type={type} value={value} onChange={(event) => updateValue(key, event.target.value)} />}</label>;
  };

  return <Page><main className="formPage registrationWizard">
    <div className="steps" aria-label="Registration progress">{stages.map((label, index) => {
      const currentStep = stage;
      return <span key={label} style={{ display: "contents" }}>
      <span className={currentStep >= index + 1 ? "on" : ""} style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="n">{index + 1}</span>{label}</span>
      {index < stages.length - 1 && <span className="bar" />}
    </span>})}</div>
    <section className="formCard">
      {error && <div className="err" role="alert">{error}</div>}
      {message && <div className="info" role="status">{message}</div>}
      {!restored ? <p className="muted">Restoring your registration…</p> : <>
        {stage === 1 && <><h1>{accountCreated ? "Your account" : `Create your ${title.toLowerCase()} account`}</h1>
          <p className="sub">Progress is saved without storing your password. Required fields are marked.</p>
          <form onSubmit={createAccount}>
            {kind === "institution" ? <label className="field">Institution name *<input name="name" required readOnly={accountCreated} value={values.name || ""} onChange={(e) => updateValue("name", e.target.value)} /></label>
              : <label className="field">{accountTitle} *<input name="fullName" required minLength={2} readOnly={accountCreated} value={values.fullName || ""} onChange={(e) => updateValue("fullName", e.target.value)} /></label>}
            {kind === "institution" && <label className="field">Contact person name *<input name="contactName" required readOnly={accountCreated} value={values.contactName || ""} onChange={(e) => updateValue("contactName", e.target.value)} /></label>}
            <label className="field">Email address *<input name="email" type="email" required readOnly={accountCreated} value={emailValue} onChange={(e) => updateValue("email", e.target.value)} /></label>
            <label className="field">Mobile number *<input name="phone" type="tel" required readOnly={accountCreated} value={values.phone || ""} onChange={(e) => updateValue("phone", e.target.value)} placeholder="+91 98XXXXXXXX" /></label>
            {kind === "recruiter" && <>
              <label className="field">Recruiter type *<select name="recruiterType" disabled={accountCreated} value={values.recruiterType || "CORPORATE"} onChange={(e) => updateValue("recruiterType", e.target.value)}><option value="FREELANCE">Freelance recruiter</option><option value="CORPORATE">Corporate recruiter</option></select></label>
              {values.recruiterType !== "FREELANCE" && <label className="field">Company name *<input name="companyName" required={!accountCreated} readOnly={accountCreated} value={values.companyName || ""} onChange={(e) => updateValue("companyName", e.target.value)} /></label>}
            </>}
            {!accountCreated && <>
              <label className="field">Password *<input name="password" type="password" required minLength={12} autoComplete="new-password" /></label>
              <label className="field">Confirm password *<input name="confirmPassword" type="password" required minLength={12} autoComplete="new-password" /></label>
              <label className="check"><input name="terms" type="checkbox" required /> I accept the Terms and Privacy Policy</label>
            </>}
            <button className="btn block" disabled={busy}>{busy ? "Please wait…" : accountCreated ? "Continue to profile" : "Continue"}</button>
          </form>
          <p className="center"><Link className="altLink" href={kind === "candidate" ? "/candidate/login" : kind === "recruiter" ? "/recruiter/login" : "/institution/login"}>Already registered? Sign in to resume</Link></p>
        </>}

        {stage === 2 && <><h1>{title} profile</h1><p className="sub">Your information is saved to your existing profile. Save a draft to finish later.</p>
          <button type="button" className="linkBtn" onClick={() => setStage(1)}>Previous</button>
          {kind === "recruiter" && values.recruiterType === "CORPORATE" && <p className="notice warning">Company verification remains pending until reviewed by Jobinfo India.</p>}
          {kind === "institution" && <p className="notice warning">Institution verification remains pending until reviewed by Jobinfo India.</p>}
          <div className="registrationProfileGrid">{profileFields[kind].map(renderProfileField)}</div>
          {kind === "institution" && <section className="registrationLists">
            {(["departments", "courses", "passingYears"] as const).map((key) => <div key={key} className="registrationListEditor">
              <h3>{key === "departments" ? "Departments" : key === "courses" ? "Courses offered" : "Available passing years"}</h3>
              {listEntries[key].map((item, index) => <div className="registrationListRow" key={`${key}-${index}`}>
                <input aria-label={`${key} ${index + 1}`} type={key === "passingYears" ? "number" : "text"} min={key === "passingYears" ? 1990 : undefined} max={key === "passingYears" ? 2100 : undefined} value={item} onChange={(e) => setListEntries((current) => ({ ...current, [key]: current[key].map((value, i) => i === index ? e.target.value : value) }))} />
                {listEntries[key].length > 1 && <button className="linkBtn" type="button" onClick={() => setListEntries((current) => ({ ...current, [key]: current[key].filter((_, i) => i !== index) }))}>Remove</button>}
              </div>)}
              <button type="button" className="btn outline sm" onClick={() => setListEntries((current) => ({ ...current, [key]: [...current[key], ""] }))}>Add more {key === "departments" ? "department" : key === "courses" ? "course" : "year"}</button>
            </div>)}
          </section>}
          {recordFields[kind].map((group) => <fieldset className="registrationRecordGroup" key={group.key}><legend>{group.title}</legend>
            {rows[group.key].map((row, index) => <div className="registrationRecord" key={`${group.key}-${index}`}>
              <h3>{group.title} {index + 1}</h3>
              <div className="registrationProfileGrid">{group.fields.map(([key, label, type]) =>
                <label className="field" key={key}>{label}<input type={type} value={row[key] || ""} onChange={(e) => updateRow(group.key, index, key, e.target.value)} /></label>,
              )}</div>
              {group.key === "workExperience" && <label className="check"><input type="checkbox" checked={row.current === "true"} onChange={(e) => updateRow(group.key, index, "current", String(e.target.checked))} /> Current employment</label>}
              {rows[group.key].length > 1 && <button type="button" className="linkBtn" onClick={() => setRows((current) => ({ ...current, [group.key]: current[group.key].filter((_, i) => i !== index) }))}>Remove</button>}
            </div>)}
            <button type="button" className="btn outline sm" onClick={() => setRows((current) => ({ ...current, [group.key]: [...current[group.key], makeRow(group.fields)] }))}>Add more {group.title.toLowerCase()}</button>
          </fieldset>)}
          {kind === "candidate" && <div className="registrationProfileGrid">
            <label className="field">Profile photograph<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles((current) => ({ ...current, photo: e.target.files?.[0] ? [e.target.files[0]] : [] }))} /></label>
            <label className="field">Resume<input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFiles((current) => ({ ...current, resume: e.target.files?.[0] ? [e.target.files[0]] : [] }))} /></label>
          </div>}
          {kind === "recruiter" && <div className="registrationProfileGrid">
            <label className="field">Recruiter profile photograph<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles((current) => ({ ...current, recruiterPhoto: e.target.files?.[0] ? [e.target.files[0]] : [] }))} /></label>
            <label className="field">Company logo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles((current) => ({ ...current, companyLogo: e.target.files?.[0] ? [e.target.files[0]] : [] }))} /></label>
            {values.recruiterType !== "FREELANCE" && <label className="field">Company verification documents<input type="file" multiple accept=".pdf,image/jpeg,image/png,application/pdf" onChange={(e) => setFiles((current) => ({ ...current, companyVerification: Array.from(e.target.files ?? []) }))} /></label>}
          </div>}
          {kind === "institution" && <div className="registrationProfileGrid">
            <label className="field">Institution logo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles((current) => ({ ...current, institutionLogo: e.target.files?.[0] ? [e.target.files[0]] : [] }))} /></label>
            <label className="field">Registration documents<input type="file" multiple accept=".pdf,image/jpeg,image/png,application/pdf" onChange={(e) => setFiles((current) => ({ ...current, institutionRegistration: Array.from(e.target.files ?? []) }))} /></label>
            <label className="field">Accreditation documents<input type="file" multiple accept=".pdf,image/jpeg,image/png,application/pdf" onChange={(e) => setFiles((current) => ({ ...current, institutionAccreditation: Array.from(e.target.files ?? []) }))} /></label>
            <label className="field">Affiliation documents<input type="file" multiple accept=".pdf,image/jpeg,image/png,application/pdf" onChange={(e) => setFiles((current) => ({ ...current, institutionAffiliation: Array.from(e.target.files ?? []) }))} /></label>
          </div>}
          <div className="registrationActions"><button type="button" className="btn outline" disabled={busy} onClick={() => void saveProfile(false)}>{busy ? "Saving…" : "Save draft"}</button><button type="button" className="btn" disabled={busy} onClick={() => void saveProfile(true)}>{busy ? "Saving…" : "Complete registration"}</button></div>
        </>}

        {stage === 3 && <div className="done"><div className="tick">✓</div><h1>Registration complete</h1><p className="sub">{kind === "candidate" ? "Your candidate profile is saved." : kind === "recruiter" ? "Your recruiter profile is saved. Corporate verification is pending where applicable." : "Your institution profile is saved and awaiting verification."}</p><Link className="btn block" href={dashboard[kind]}>Go to dashboard</Link></div>}
      </>}
    </section>
  </main></Page>;
}
