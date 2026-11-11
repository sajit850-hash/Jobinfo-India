"use client";
import { useState } from "react";
import { useEffect } from "react";
import { api } from "@/lib/api";
export function SaveJobButton({ jobId }: { jobId: string }) {
  const [saved,setSaved]=useState(false); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  useEffect(()=>{let live=true;api<{saved:boolean}>(`/api/v1/candidates/saved-jobs/${jobId}`).then(r=>{if(live&&r.ok)setSaved(r.data.saved)});return()=>{live=false};},[jobId]);
  async function toggle(){setBusy(true);setMessage("");const r=await api(`/api/v1/candidates/saved-jobs/${jobId}`,{method:saved?"DELETE":"POST"});setBusy(false);if(r.ok){setSaved(!saved);setMessage(saved?"Removed from saved jobs":"Saved to your jobs");}else setMessage(r.data.error||"Sign in as a candidate to save jobs");}
  return <div><button className="btn outline" onClick={toggle} disabled={busy}>{busy?"Please wait…":saved?"Saved ✓":"♡ Save job"}</button>{message&&<small className="muted">{message}</small>}</div>;
}
