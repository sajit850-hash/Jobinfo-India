"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
export function ApplyButton({jobId}:{jobId:string}){const [msg,setMsg]=useState("");const [busy,setBusy]=useState(false);async function apply(){setBusy(true);setMsg("");const r=await api("/api/v1/applications",{method:"POST",body:JSON.stringify({jobId})});setBusy(false);setMsg(r.ok?"Application submitted successfully.":r.data.error||"Unable to apply");}return <div><button className="btn" onClick={apply} disabled={busy}>{busy?"Submitting…":"Apply now"}</button>{msg&&<p>{msg}</p>}<p className="muted"><Link href="/login">Sign in</Link> if you are not already logged in.</p></div>}
