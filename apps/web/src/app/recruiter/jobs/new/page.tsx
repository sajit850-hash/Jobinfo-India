"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

const stepNames = ["Basic information", "Workplace & location", "Job description", "Skills & qualifications", "Salary & compensation", "Application settings", "Screening questions", "Hiring team", "Recruitment preferences", "Review & preview", "Posting plan", "Publish job"];
type DraftData = Record<string, any>;
type PostingPlan = { id: string; code: string; name: string; description?: string | null; pricePaise: number; durationDays: number; features: string[] | unknown };
const initialData: DraftData = {
  basic: { title: "", companyName: "", department: "", category: "", jobFunction: "", employmentType: "FULL_TIME", experienceLevel: "MID_LEVEL", experienceMin: 0, experienceMax: 5, openings: 1 },
  workplace: { workplaceType: "ON_SITE", country: "India", state: "", city: "", officeAddress: "", remoteEligibility: "", relocationAssistance: false, travelRequirement: "" },
  description: { aboutCompany: "", overview: "", responsibilities: "", requiredQualifications: "", preferredQualifications: "", technicalRequirements: "", benefitsAndPerks: "", equalOpportunityStatement: "" },
  skills: { required: [], preferred: [], technical: [], soft: [], education: [], certifications: [], languages: [], specialization: "" },
  compensation: { minimum: null, maximum: null, currency: "INR", period: "ANNUAL", disclose: true, incentives: "", bonus: "", benefits: [], otherBenefits: "" },
  application: { method: "INTERNAL", externalUrl: "", deadline: "", resumeRequired: true, coverLetterRequired: false, allowUpdates: true, collectAdditionalInformation: false, confirmationEmail: true, maxApplications: null },
  screening: [], team: { members: [] },
  preferences: { urgent: false, immediateJoining: false, backgroundVerification: false, workAuthorization: "", interviewRounds: null, expectedJoiningDate: "", visibility: "PUBLIC" },
  planCode: "",
};

function Field({ label, value, onChange, type = "text", required = false, min, max, placeholder }: { label: string; value: any; onChange: (value: any) => void; type?: string; required?: boolean; min?: number; max?: number; placeholder?: string }) {
  return <label className="field">{label}<input type={type} value={value ?? ""} required={required} min={min} max={max} placeholder={placeholder} onChange={(e) => onChange(type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)} /></label>;
}
function Area({ label, value, onChange, required = false, rows = 5, placeholder }: { label: string; value: any; onChange: (value: string) => void; required?: boolean; rows?: number; placeholder?: string }) {
  return <label className="field">{label}<textarea value={value ?? ""} required={required} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>;
}
function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <label className="field">{label}<select value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="wizardToggle"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}</label>;
}
function csv(values: string[]) { return values.join(", "); }
function parseCsv(value: string) { return [...new Set(value.split(",").map((x) => x.trim()).filter(Boolean))]; }

function NewJobForm() {
  const search = useSearchParams();
  const [data, setData] = useState<DraftData>(initialData);
  const [step, setStep] = useState(0);
  const [draftId, setDraftId] = useState("");
  const [version, setVersion] = useState(0);
  const [plans, setPlans] = useState<PostingPlan[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [postingAuthorized, setPostingAuthorized] = useState(false);
  const [companyName, setCompanyName] = useState("");

  const setSection = (section: string, key: string, value: any) => setData((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));
  const selectedPlan = useMemo(() => plans.find((plan) => plan.code === data.planCode), [plans, data.planCode]);

  useEffect(() => {
    let active = true;
    void Promise.all([api<any>("/api/v1/recruiters/me"), api<{ data: PostingPlan[] }>("/api/v1/jobs/posting-plans")]).then(async ([me, planResult]) => {
      if (!active) return;
      if (!me.ok) { setError(me.data.error || "Sign in as a recruiter to post a job."); return; }
      setCompanyName(me.data.employer.name || "");
      setData((current) => ({ ...current, basic: { ...current.basic, companyName: me.data.employer.name || "" }, description: { ...current.description, aboutCompany: current.description.aboutCompany || "" } }));
      if (planResult.ok) setPlans(planResult.data.data);
      const existingId = search.get("draft");
      if (existingId) {
        const loaded = await api<any>(`/api/v1/jobs/drafts/${existingId}`);
        if (!active) return;
        if (loaded.ok) {
          setDraftId(existingId); setVersion(loaded.data.draft.version); setStep(Math.max(0, Math.min(11, loaded.data.draft.currentStep - 1)));
          setData((current) => ({ ...current, ...loaded.data.draft.data, basic: { ...current.basic, ...loaded.data.draft.data.basic, companyName: me.data.employer.name || "" } }));
          const entitlement = await api<{ authorized: boolean }>(`/api/v1/jobs/${existingId}/posting-entitlement`);
          if (entitlement.ok && entitlement.data.authorized) setPostingAuthorized(true);
          if ((!entitlement.ok || !entitlement.data.authorized) && (search.get("razorpay_payment_link_id") || search.get("razorpay_payment_id"))) {
            for (let attempt = 0; attempt < 10; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              const refreshed = await api<{ authorized: boolean }>(`/api/v1/jobs/${existingId}/posting-entitlement`);
              if (refreshed.ok && refreshed.data.authorized) { setPostingAuthorized(true); setNotice("Payment verified and posting entitlement is active."); window.history.replaceState(null, "", `/recruiter/jobs/new?draft=${existingId}`); break; }
            }
          }
          const testPayment = search.get("testPayment");
          if (testPayment) {
            const confirmed = await api<any>(`/api/v1/jobs/${existingId}/payment/dev-confirm/${testPayment}`, { method: "POST" });
            if (confirmed.ok) { setPostingAuthorized(true); setNotice("Test posting payment confirmed. No real money was charged."); window.history.replaceState(null, "", `/recruiter/jobs/new?draft=${existingId}`); }
            else setError(confirmed.data.error || "Could not confirm test checkout.");
          }
        }
        else setError(loaded.data.error || "Could not load this draft.");
      }
    });
    return () => { active = false; };
  }, [search]);

  async function saveDraft(nextStep = step) {
    setError("");
    const body = JSON.stringify({ data, currentStep: nextStep + 1, ...(draftId ? { expectedVersion: version } : {}) });
    const result = draftId
      ? await api<any>(`/api/v1/jobs/drafts/${draftId}`, { method: "PATCH", body })
      : await api<any>("/api/v1/jobs/drafts", { method: "POST", body: JSON.stringify({ data, currentStep: nextStep + 1 }) });
    if (!result.ok) { setError(result.data.error || "Could not save your draft."); return false; }
    if (!draftId) { setDraftId(result.data.jobId); window.history.replaceState(null, "", `/recruiter/jobs/new?draft=${result.data.jobId}`); }
    setVersion(result.data.draft.version || 1);
    return true;
  }
  function validateCurrentStep() {
    const { basic, workplace, description, skills, application, screening } = data;
    const fail = (message: string) => { setError(message); return false; };
    if (step === 0) {
      if (!basic.title.trim() || !basic.companyName.trim() || !basic.department.trim() || !basic.category.trim()) return fail("Complete the job title, company, department and category.");
      if (Number(basic.experienceMax) < Number(basic.experienceMin)) return fail("Maximum experience must be at least the minimum.");
    }
    if (step === 1 && workplace.workplaceType !== "REMOTE" && (!workplace.city.trim() || !workplace.state.trim())) return fail("Add a city and state for on-site or hybrid work.");
    if (step === 1 && workplace.workplaceType === "REMOTE" && !workplace.remoteEligibility.trim()) return fail("Choose where remote candidates may work.");
    if (step === 2 && (description.overview.trim().length < 20 || description.responsibilities.trim().length < 20 || description.requiredQualifications.trim().length < 10)) return fail("Add a job overview and responsibilities (20 characters minimum) and required qualifications (10 characters minimum).");
    if (step === 3 && skills.required.length === 0) return fail("Add at least one required skill.");
    if (step === 5 && application.method !== "INTERNAL" && !/^https?:\/\//i.test(application.externalUrl)) return fail("Enter a valid external application URL.");
    if (step === 6 && screening.some((question: any) => question.prompt.trim().length < 5 || (["SINGLE_CHOICE", "MULTIPLE_CHOICE"].includes(question.type) && question.options.length === 0))) return fail("Each screening question needs a prompt of at least 5 characters and choice questions need options.");
    return true;
  }
  async function next() {
    setError(""); if (!validateCurrentStep()) return;
    setBusy(true); setNotice("");
    const saved = await saveDraft(Math.min(step + 1, 11));
    setBusy(false);
    if (saved) { setStep((current) => Math.min(current + 1, 11)); setNotice("Draft saved"); }
  }
  async function previous() { setError(""); setStep((current) => Math.max(0, current - 1)); }
  async function saveAndExit() {
    setBusy(true); const saved = await saveDraft(); setBusy(false);
    if (saved) setNotice("Draft saved. You can continue it later from the saved link.");
  }
  async function checkout() {
    if (!draftId || !selectedPlan) return;
    setBusy(true); setError(""); setCheckoutUrl("");
    const saved = await saveDraft(step);
    if (!saved) { setBusy(false); return; }
    const result = await api<any>(`/api/v1/jobs/${draftId}/checkout`, { method: "POST", body: JSON.stringify({ planCode: selectedPlan.code, returnUrl: `${window.location.origin}/recruiter/jobs/new?draft=${draftId}` }) });
    setBusy(false);
    if (!result.ok) { setError(result.data.error || "Could not start checkout."); return; }
    setData((current) => ({ ...current, planCode: selectedPlan.code }));
    setCheckoutUrl(result.data.checkoutUrl || ""); setTransactionId(result.data.transactionId || ""); setTestMode(result.data.mode === "test");
    if (result.data.mode === "free") { setPostingAuthorized(true); setNotice("Free posting plan selected."); }
    else if (result.data.checkoutUrl) setNotice("Checkout is ready. Complete payment, then return here to submit the job.");
  }
  async function confirmTestPayment() {
    if (!draftId || !transactionId) return;
    setBusy(true); const result = await api<any>(`/api/v1/jobs/${draftId}/payment/dev-confirm/${transactionId}`, { method: "POST" }); setBusy(false);
    if (!result.ok) setError(result.data.error || "Test checkout confirmation failed."); else { setTestMode(false); setPostingAuthorized(true); setNotice("Test posting plan confirmed. No real money was charged."); }
  }
  async function publish() {
    setBusy(true); setError("");
    const saved = await saveDraft(step);
    if (!saved) { setBusy(false); return; }
    const result = await api<any>(`/api/v1/jobs/${draftId}/submit-approval`, { method: "POST" });
    setBusy(false);
    if (!result.ok) setError(result.data.error || "Could not submit this job."); else { setNotice("Job submitted for review."); window.location.assign("/recruiter/jobs"); }
  }

  const addScreening = () => setData((current) => ({ ...current, screening: [...current.screening, { prompt: "", type: "YES_NO", required: false, mustHave: false, knockout: false, rejectionMessage: "", options: [], active: true }] }));
  const updateQuestion = (index: number, key: string, value: any) => setData((current) => ({ ...current, screening: current.screening.map((q: any, i: number) => i === index ? { ...q, [key]: value } : q) }));
  const addMember = () => setData((current) => ({ ...current, team: { members: [...current.team.members, { email: "", permissions: ["VIEW_JOB", "VIEW_APPLICANTS"] }] } }));
  const updateMember = (index: number, key: string, value: any) => setData((current) => ({ ...current, team: { members: current.team.members.map((member: any, i: number) => i === index ? { ...member, [key]: value } : member) } }));

  const content = () => {
    const b = data.basic, w = data.workplace, d = data.description, s = data.skills, c = data.compensation, a = data.application, p = data.preferences;
    switch (step) {
      case 0: return <><div className="wizardGrid"><Field label="Job title" value={b.title} onChange={(v) => setSection("basic", "title", v)} required placeholder="e.g. Senior Product Designer"/><Field label="Company" value={b.companyName} onChange={(v) => setSection("basic", "companyName", v)} required/><Field label="Department" value={b.department} onChange={(v) => setSection("basic", "department", v)} required placeholder="e.g. Product"/><Field label="Job category" value={b.category} onChange={(v) => setSection("basic", "category", v)} required/><Field label="Job function" value={b.jobFunction} onChange={(v) => setSection("basic", "jobFunction", v)}/><Choice label="Employment type" value={b.employmentType} onChange={(v) => setSection("basic", "employmentType", v)} options={[["FULL_TIME","Full-time"],["PART_TIME","Part-time"],["CONTRACT","Contract"],["TEMPORARY","Temporary"],["INTERN","Internship"]]}/><Choice label="Experience level" value={b.experienceLevel} onChange={(v) => setSection("basic", "experienceLevel", v)} options={[["ENTRY_LEVEL","Entry level"],["ASSOCIATE","Associate"],["MID_LEVEL","Mid level"],["SENIOR_LEVEL","Senior level"],["DIRECTOR","Director"],["EXECUTIVE","Executive"]]}/><Field label="Minimum experience (years)" type="number" min={0} max={50} value={b.experienceMin} onChange={(v) => setSection("basic", "experienceMin", v ?? 0)} required/><Field label="Maximum experience (years)" type="number" min={0} max={50} value={b.experienceMax} onChange={(v) => setSection("basic", "experienceMax", v ?? 0)} required/><Field label="Number of openings" type="number" min={1} value={b.openings} onChange={(v) => setSection("basic", "openings", v ?? 1)} required/></div></>;
      case 1: return <><div className="wizardGrid"><Choice label="Workplace type" value={w.workplaceType} onChange={(v) => setSection("workplace", "workplaceType", v)} options={[["ON_SITE","On-site"],["HYBRID","Hybrid"],["REMOTE","Remote"]]}/><Field label="Country" value={w.country} onChange={(v) => setSection("workplace", "country", v)} required/><Field label="State" value={w.state} onChange={(v) => setSection("workplace", "state", v)} required={w.workplaceType !== "REMOTE"}/><Field label="City" value={w.city} onChange={(v) => setSection("workplace", "city", v)} required={w.workplaceType !== "REMOTE"}/><Field label="Office address" value={w.officeAddress} onChange={(v) => setSection("workplace", "officeAddress", v)}/>{w.workplaceType === "REMOTE" && <Field label="Remote eligibility" value={w.remoteEligibility} onChange={(v) => setSection("workplace", "remoteEligibility", v)} required placeholder="e.g. India only"/>}<Field label="Travel requirement" value={w.travelRequirement} onChange={(v) => setSection("workplace", "travelRequirement", v)}/></div><Toggle label="Relocation assistance available" checked={w.relocationAssistance} onChange={(v) => setSection("workplace", "relocationAssistance", v)}/></>;
      case 2: return <><Area label="About the company" value={d.aboutCompany} onChange={(v) => setSection("description", "aboutCompany", v)} rows={3}/><Area label="Job overview" value={d.overview} onChange={(v) => setSection("description", "overview", v)} required/><Area label="Responsibilities" value={d.responsibilities} onChange={(v) => setSection("description", "responsibilities", v)} required/><Area label="Required qualifications" value={d.requiredQualifications} onChange={(v) => setSection("description", "requiredQualifications", v)} required/><Area label="Preferred qualifications" value={d.preferredQualifications} onChange={(v) => setSection("description", "preferredQualifications", v)}/><Area label="Technical requirements" value={d.technicalRequirements} onChange={(v) => setSection("description", "technicalRequirements", v)}/><Area label="Benefits and perks" value={d.benefitsAndPerks} onChange={(v) => setSection("description", "benefitsAndPerks", v)}/><Area label="Equal opportunity statement" value={d.equalOpportunityStatement} onChange={(v) => setSection("description", "equalOpportunityStatement", v)}/></>;
      case 3: return <><p className="muted">Use commas to separate skills, certificates, and languages.</p><div className="wizardGrid"><Field label="Required skills" value={csv(s.required)} onChange={(v) => setSection("skills", "required", parseCsv(v))} required placeholder="e.g. React, TypeScript"/><Field label="Preferred skills" value={csv(s.preferred)} onChange={(v) => setSection("skills", "preferred", parseCsv(v))}/><Field label="Technical skills" value={csv(s.technical)} onChange={(v) => setSection("skills", "technical", parseCsv(v))}/><Field label="Soft skills" value={csv(s.soft)} onChange={(v) => setSection("skills", "soft", parseCsv(v))}/><Field label="Education / degree" value={s.education.map((x: any) => x.name).join(", ")} onChange={(v) => setSection("skills", "education", parseCsv(v).map((name) => ({ name, minimum: "", preferred: false })))}/><Field label="Certifications" value={csv(s.certifications)} onChange={(v) => setSection("skills", "certifications", parseCsv(v))}/><Field label="Languages" value={csv(s.languages)} onChange={(v) => setSection("skills", "languages", parseCsv(v))}/><Field label="Specialization" value={s.specialization} onChange={(v) => setSection("skills", "specialization", v)}/></div></>;
      case 4: return <><Toggle label="Show salary range to candidates" checked={c.disclose} onChange={(v) => setSection("compensation", "disclose", v)}/>{c.disclose && <div className="wizardGrid"><Field label="Minimum compensation" type="number" min={0} value={c.minimum} onChange={(v) => setSection("compensation", "minimum", v)}/><Field label="Maximum compensation" type="number" min={0} value={c.maximum} onChange={(v) => setSection("compensation", "maximum", v)}/><Choice label="Currency" value={c.currency} onChange={(v) => setSection("compensation", "currency", v)} options={[["INR","INR — Indian Rupee"],["USD","USD — US Dollar"]]}/><Choice label="Pay period" value={c.period} onChange={(v) => setSection("compensation", "period", v)} options={[["ANNUAL","Annual"],["MONTHLY","Monthly"],["DAILY","Daily"],["HOURLY","Hourly"]]}/></div>}<div className="wizardGrid"><Field label="Incentives" value={c.incentives} onChange={(v) => setSection("compensation", "incentives", v)}/><Field label="Bonus" value={c.bonus} onChange={(v) => setSection("compensation", "bonus", v)}/><Field label="Benefits (comma separated)" value={csv(c.benefits)} onChange={(v) => setSection("compensation", "benefits", parseCsv(v))}/><Field label="Other benefits" value={c.otherBenefits} onChange={(v) => setSection("compensation", "otherBenefits", v)}/></div></>;
      case 5: return <><div className="wizardGrid"><Choice label="How should candidates apply?" value={a.method} onChange={(v) => setSection("application", "method", v)} options={[["INTERNAL","Apply on Jobinfo India"],["EXTERNAL","External application link"],["COMPANY_SITE","Company careers site"]]}/>{a.method !== "INTERNAL" && <Field label="Application URL" type="url" value={a.externalUrl} onChange={(v) => setSection("application", "externalUrl", v)} required/>}<Field label="Application deadline" type="date" value={a.deadline} onChange={(v) => setSection("application", "deadline", v)}/><Field label="Maximum applications" type="number" min={1} value={a.maxApplications} onChange={(v) => setSection("application", "maxApplications", v)}/></div><div className="wizardToggleList"><Toggle label="Require a resume" checked={a.resumeRequired} onChange={(v) => setSection("application", "resumeRequired", v)}/><Toggle label="Require a cover letter" checked={a.coverLetterRequired} onChange={(v) => setSection("application", "coverLetterRequired", v)}/><Toggle label="Allow application updates" checked={a.allowUpdates} onChange={(v) => setSection("application", "allowUpdates", v)}/><Toggle label="Collect additional information" checked={a.collectAdditionalInformation} onChange={(v) => setSection("application", "collectAdditionalInformation", v)}/><Toggle label="Send confirmation email" checked={a.confirmationEmail} onChange={(v) => setSection("application", "confirmationEmail", v)}/></div></>;
      case 6: return <><p className="muted">Add optional questions to learn more about applicants. Questions marked as must-have or knockout should relate directly to the role.</p>{data.screening.map((q: any, index: number) => <article className="card wizardItem" key={index}><div className="wizardGrid"><Field label={`Question ${index + 1}`} value={q.prompt} onChange={(v) => updateQuestion(index, "prompt", v)} required/><Choice label="Answer type" value={q.type} onChange={(v) => updateQuestion(index, "type", v)} options={[["YES_NO","Yes / No"],["SINGLE_CHOICE","Single choice"],["MULTIPLE_CHOICE","Multiple choice"],["NUMBER","Number"],["TEXT","Text"],["EXPERIENCE","Experience"],["LOCATION","Location"],["CERTIFICATION","Certification"]]}/>{["SINGLE_CHOICE", "MULTIPLE_CHOICE"].includes(q.type) && <Field label="Options (comma separated)" value={csv(q.options)} onChange={(v) => updateQuestion(index, "options", parseCsv(v))}/>}</div><div className="wizardToggleList"><Toggle label="Required" checked={q.required} onChange={(v) => updateQuestion(index, "required", v)}/><Toggle label="Must have" checked={q.mustHave} onChange={(v) => updateQuestion(index, "mustHave", v)}/><Toggle label="Knockout question" checked={q.knockout} onChange={(v) => updateQuestion(index, "knockout", v)}/></div><button type="button" className="btn outline sm danger" onClick={() => setData((current) => ({ ...current, screening: current.screening.filter((_: any, i: number) => i !== index) }))}>Remove question</button></article>)}<button type="button" className="btn outline" onClick={addScreening}>Add screening question</button></>;
      case 7: return <><p className="muted">Invite teammates by email and choose what they can do for this job.</p>{data.team.members.map((member: any, index: number) => <article className="card wizardItem" key={index}><Field label="Team member email" type="email" value={member.email} onChange={(v) => updateMember(index, "email", v)} required/><div className="wizardToggleList">{[["VIEW_JOB","View job"],["EDIT_JOB","Edit job"],["VIEW_APPLICANTS","View applicants"],["DOWNLOAD_RESUMES","Download resumes"],["SHORTLIST_CANDIDATES","Shortlist candidates"],["REJECT_CANDIDATES","Reject candidates"],["MANAGE_APPLICATIONS","Manage applications"]].map(([permission, label]) => <Toggle key={permission} label={label} checked={member.permissions.includes(permission)} onChange={(on) => updateMember(index, "permissions", on ? [...member.permissions, permission] : member.permissions.filter((x: string) => x !== permission))}/>)}</div></article>)}<button type="button" className="btn outline" onClick={addMember}>Add hiring team member</button></>;
      case 8: return <><div className="wizardToggleList"><Toggle label="Mark as urgent hiring" checked={p.urgent} onChange={(v) => setSection("preferences", "urgent", v)}/><Toggle label="Immediate joining required" checked={p.immediateJoining} onChange={(v) => setSection("preferences", "immediateJoining", v)}/><Toggle label="Background verification required" checked={p.backgroundVerification} onChange={(v) => setSection("preferences", "backgroundVerification", v)}/></div><div className="wizardGrid"><Field label="Work authorization requirements" value={p.workAuthorization} onChange={(v) => setSection("preferences", "workAuthorization", v)}/><Field label="Interview rounds" type="number" min={1} max={20} value={p.interviewRounds} onChange={(v) => setSection("preferences", "interviewRounds", v)}/><Field label="Expected joining date" type="date" value={p.expectedJoiningDate} onChange={(v) => setSection("preferences", "expectedJoiningDate", v)}/><Choice label="Listing visibility" value={p.visibility} onChange={(v) => setSection("preferences", "visibility", v)} options={[["PUBLIC","Public — discoverable in job search"],["UNLISTED","Unlisted — link only"]]}/></div></>;
      case 9: return <><p className="muted">Review the details before selecting a posting plan. You can go back to edit any section.</p><div className="jobPreview"><p className="eyebrow">{b.companyName} · {b.department}</p><h2>{b.title || "Job title"}</h2><p>{[w.city, w.state, w.country].filter(Boolean).join(", ")} · {w.workplaceType.replace("_", " ")} · {b.employmentType.replaceAll("_", " ")}</p><p>{b.experienceMin}–{b.experienceMax} years · {b.openings} opening(s)</p>{c.disclose && <p>{c.currency} {c.minimum ?? "—"}–{c.maximum ?? "—"} / {c.period.toLowerCase()}</p>}<hr/><h3>Overview</h3><p>{d.overview || "Add a job overview"}</p><h3>Responsibilities</h3><p>{d.responsibilities || "Add responsibilities"}</p><h3>Qualifications</h3><p>{d.requiredQualifications || "Add required qualifications"}</p><h3>Required skills</h3><div className="tags">{s.required.map((x: string) => <span className="tag" key={x}>{x}</span>)}</div><p className="muted">{a.method === "INTERNAL" ? "Candidates apply on Jobinfo India" : `Application link: ${a.externalUrl}`}</p></div></>;
      case 10: return <><p className="muted">Choose a plan for this listing. Payments depend on the configured provider.</p><div className="grid3 recruiterPlanGrid">{plans.map((plan) => <article className={`card wizardPlan ${data.planCode === plan.code ? "selected" : ""}`} key={plan.id}><label className="wizardPlanChoice"><input type="radio" name="postingPlan" checked={data.planCode === plan.code} onChange={() => { setPostingAuthorized(false); setData((current) => ({ ...current, planCode: plan.code })); }}/><span><b>{plan.name}</b><strong>{plan.pricePaise ? `₹${(plan.pricePaise / 100).toLocaleString("en-IN")}` : "Free"}</strong></span></label><p>{plan.description || `${plan.durationDays} day listing`}</p>{Array.isArray(plan.features) && <ul className="planFeatures">{plan.features.map((feature: any) => <li key={String(feature)}>{String(feature)}</li>)}</ul>}</article>)}</div>{!plans.length && <p className="muted">No active posting plans are available. Contact support.</p>}<button className="btn" type="button" disabled={busy || !selectedPlan || !draftId} onClick={checkout}>{busy ? "Processing…" : selectedPlan?.pricePaise ? "Continue to checkout" : postingAuthorized ? "Free plan selected" : "Select free plan"}</button>{checkoutUrl && <p><a className="textLink" href={checkoutUrl}>Open checkout</a></p>}{testMode && <button className="btn outline" type="button" disabled={busy} onClick={confirmTestPayment}>Confirm test payment (development only)</button>}</>;
      default: return <><div className="info">{selectedPlan ? `${selectedPlan.name} plan selected.` : "Select a posting plan to continue."} Your job will be submitted for review before it appears to candidates.</div><div className="jobPreview"><h2>{b.title}</h2><p>{b.companyName} · {[w.city, w.state, w.country].filter(Boolean).join(", ")}</p><p>{d.overview}</p><p className="muted">Plan: {selectedPlan?.name || "Not selected"}</p></div><button type="button" className="btn" disabled={busy || !selectedPlan} onClick={publish}>{busy ? "Submitting…" : "Publish job for review"}</button></>;
    }
  };

  return <Page><main className="wrap section jobWizardPage"><div className="sectionTitle"><div><p className="eyebrow">RECRUITER WORKSPACE</p><h1>Create a job post</h1><p className="muted">A guided posting flow to help you publish a clear, complete listing.</p></div><Link className="textLink" href="/recruiter/jobs">My posted jobs</Link></div>
    {error && <div className="err">{error} {error.toLowerCase().includes("sign in") && <Link href="/login">Sign in</Link>}</div>}{notice && <div className="info">{notice}</div>}
    <div className="wizardLayout"><aside className="card wizardSteps" aria-label="Job post steps"><ol>{stepNames.map((name, index) => <li key={name}><button type="button" className={index === step ? "active" : index < step ? "complete" : ""} onClick={async () => { if (index < step) setStep(index); else if (index === step + 1) await next(); }}><span>{index < step ? "✓" : index + 1}</span>{name}</button></li>)}</ol><button type="button" className="btn outline sm" disabled={busy} onClick={saveAndExit}>{busy ? "Saving…" : "Save draft & exit"}</button>{draftId && <small>Draft saved · <button className="wizardCopyLink" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/recruiter/jobs/new?draft=${draftId}`); setNotice("Draft link copied."); }}>Copy resume link</button></small>}</aside>
      <section className="card wizardPanel"><div className="wizardPanelHead"><div><p className="eyebrow">STEP {step + 1} OF {stepNames.length}</p><h2>{stepNames[step]}</h2></div><span className="muted">{companyName}</span></div><div className="wizardContent">{content()}</div><footer className="wizardFooter">{step > 0 && <button type="button" className="btn outline" disabled={busy} onClick={previous}>Back</button>}<span className="muted">{draftId ? "Your changes are saved as you move through the steps." : "Your job details are saved as a draft."}</span>{step < 9 && <button type="button" className="btn" disabled={busy} onClick={next}>{busy ? "Saving…" : "Save and continue"}</button>}{step === 9 && <button type="button" className="btn" disabled={busy} onClick={next}>{busy ? "Saving…" : "Continue to posting plan"}</button>}{step === 10 && <button type="button" className="btn" disabled={busy || !selectedPlan || !postingAuthorized} onClick={() => setStep(11)}>{busy ? "Saving…" : "Continue to publish"}</button>}</footer></section></div>
  </main></Page>;
}

export default function NewJob() {
  return <Suspense fallback={<Page><main className="wrap section"><p>Loading job posting form…</p></main></Page>}><NewJobForm /></Suspense>;
}
