"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {Page} from "@/components/SiteChrome";
import {api} from "@/lib/api";

export default function RegistrationApprovals(){
  const[data,setData]=useState<any>(null),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState("");
  const refresh=async()=>{const r=await api<any>("/api/v1/admin/registrations");if(!r.ok)setError(r.data.error||"Could not load registration queue");else{setData(r.data);setError("")}};
  useEffect(()=>{void refresh()},[]);
  async function decide(item:any,type:"employer"|"institution",decision:"APPROVE"|"REJECT"){
    if(!window.confirm(`${decision==="APPROVE"?"Approve":"Reject"} ${item.name}?`))return;
    const reason=decision==="REJECT"?window.prompt("Reason for rejection (required)"):undefined;if(decision==="REJECT"&&!reason?.trim())return;
    setBusy(item.id);setError("");const url=type==="employer"?`/api/v1/admin/employers/${item.id}/verify`:`/api/v1/admin/institutions/${item.id}/verify`;
    const r=await api(url,{method:"PATCH",body:JSON.stringify({decision,reason:reason?.trim()})});setBusy("");
    if(!r.ok)setError(r.data.error||"Could not update verification");else{setMessage(`${item.name} ${decision==="APPROVE"?"approved":"rejected"}.`);void refresh()}
  }
  return <Page><main className="wrap section adminWorkspace"><div className="sectionTitle"><div><p className="eyebrow">ADMINISTRATION</p><h1>Registration approvals</h1><p className="muted">Approve or reject recruiter companies and institution registrations. Rejections require a recorded reason.</p></div><Link className="btn outline" href="/admin/dashboard">Dashboard</Link></div>
    {error&&<div className="err" role="alert">{error}</div>}{message&&<div className="info" role="status">{message}</div>}
    {data&&<><section className="card adminDashSection"><h2>Recruiter companies ({data.recruiters.length})</h2><div className="applicationList">{data.recruiters.map((row:any)=><article className="card approvalCard" key={row.id}><div><p className="eyebrow">{row.recruiterType} recruiter · {row.verificationStatus}</p><h3>{row.name}</h3><p className="muted">{row.user?.fullName||"Contact unavailable"} · {row.user?.email||""} · {row.city||"Location not provided"}</p><span className={`statusPill ${row.user?.emailVerifiedAt?"status-hired":"status-pending"}`}>{row.user?.emailVerifiedAt?"Email verified":"Email not verified"}</span>{row.verificationReason&&<p className="muted">Previous decision: {row.verificationReason}</p>}</div><div className="managedJobActions">{row.user?.id&&<Link className="btn outline sm" href={`/admin/users/${row.user.id}`}>View profile</Link>}<button className="btn sm" disabled={busy===row.id} onClick={()=>void decide(row,"employer","APPROVE")}>{busy===row.id?"Saving…":"Approve"}</button><button className="btn outline sm danger" disabled={busy===row.id} onClick={()=>void decide(row,"employer","REJECT")}>Reject</button></div></article>)}{!data.recruiters.length&&<p className="muted">No recruiter registrations awaiting review.</p>}</div></section>
    <section className="card adminDashSection"><h2>Institutions ({data.institutions.length})</h2><div className="applicationList">{data.institutions.map((row:any)=><article className="card approvalCard" key={row.id}><div><p className="eyebrow">{row.institutionType||"Institution"} · {row.verificationStatus}</p><h3>{row.name}</h3><p className="muted">{row.user?.fullName||"Contact unavailable"} · {row.user?.email||""} · {row.city}, {row.state}</p><span className={`statusPill ${row.user?.emailVerifiedAt?"status-hired":"status-pending"}`}>{row.user?.emailVerifiedAt?"Email verified":"Email not verified"}</span>{row.verificationReason&&<p className="muted">Previous decision: {row.verificationReason}</p>}</div><div className="managedJobActions">{row.user?.id&&<Link className="btn outline sm" href={`/admin/users/${row.user.id}`}>View profile</Link>}<button className="btn sm" disabled={busy===row.id} onClick={()=>void decide(row,"institution","APPROVE")}>{busy===row.id?"Saving…":"Approve"}</button><button className="btn outline sm danger" disabled={busy===row.id} onClick={()=>void decide(row,"institution","REJECT")}>Reject</button></div></article>)}{!data.institutions.length&&<p className="muted">No institution registrations awaiting review.</p>}</div></section></>}
  </main></Page>
}
