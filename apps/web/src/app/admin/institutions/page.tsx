"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {Page} from "@/components/SiteChrome";
import {api} from "@/lib/api";

export default function InstitutionApprovals(){
  const[rows,setRows]=useState<any[]>([]),[q,setQ]=useState(""),[search,setSearch]=useState(""),[verification,setVerification]=useState(""),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState("");
  const refresh=useCallback(async()=>{const params=new URLSearchParams();if(search)params.set("q",search);if(verification)params.set("verification",verification);const r=await api<{data:any[]}>(`/api/v1/admin/institutions?${params}`);if(!r.ok)setError(r.data.error||"Could not load institutions");else{setRows(r.data.data);setError("")}},[search,verification]);
  useEffect(()=>{void refresh()},[refresh]);
  async function decide(row:any,decision:"APPROVE"|"REJECT"|"REVOKE"){
    if(!window.confirm(`${decision==="APPROVE"?"Approve":decision==="REJECT"?"Reject":"Revoke verification for"} ${row.name}?`))return;
    const reason=decision==="APPROVE"?undefined:window.prompt("Reason (required)");if(decision!=="APPROVE"&&!reason?.trim())return;
    setBusy(row.id);setError("");const r=await api(`/api/v1/admin/institutions/${row.id}/verify`,{method:"PATCH",body:JSON.stringify({decision,reason:reason?.trim()})});setBusy("");
    if(!r.ok)setError(r.data.error||"Could not update verification");else{setMessage(`${row.name}: ${decision.toLowerCase()} completed.`);void refresh()}
  }
  return <Page><main className="wrap section adminInstitutionPage"><div className="sectionTitle"><div><p className="eyebrow">ADMINISTRATION</p><h1>Institution management</h1><p className="muted">Review verification, account status and linked student roster access.</p></div><Link className="btn outline" href="/admin/dashboard">Admin dashboard</Link></div>
    {error&&<div className="err" role="alert">{error}</div>}{message&&<div className="info" role="status">{message}</div>}
    <form className="card adminFilters" onSubmit={e=>{e.preventDefault();setSearch(q.trim())}}><label className="field">Search institution, contact or location<input value={q} onChange={e=>setQ(e.target.value)} placeholder="Name, email, city or state"/></label><label className="field">Verification<select value={verification} onChange={e=>setVerification(e.target.value)}><option value="">All active institutions</option><option value="VERIFIED">Verified</option><option value="PENDING">Pending or rejected</option></select></label><button className="btn">Search</button><button className="btn outline" type="button" onClick={()=>{setQ("");setSearch("");setVerification("")}}>Reset</button></form>
    <div className="applicationList">{rows.map(row=><article className="card approvalCard" key={row.id}><div><p className="eyebrow">{row.institutionType||"Institution"} · {row.verificationStatus}</p><h2>{row.name}</h2><p className="muted">{row.city}, {row.state} · {row.user?.fullName||"Contact unavailable"} · {row.user?.email||""}</p>{row.website&&<p><a className="textLink" href={row.website} target="_blank" rel="noreferrer">{row.website}</a></p>}<small>{row._count.students} students · {row.departments.length} departments · {row.courses.length} courses · Registered {row.user?.createdAt?new Date(row.user.createdAt).toLocaleDateString():"date unavailable"}</small>{row.verificationReason&&<p className="muted">Reason: {row.verificationReason}</p>}</div><div className="managedJobActions"><span className={`statusPill ${row.verified?"status-hired":"status-pending"}`}>{row.verified?"Verified":row.verificationStatus}</span>{row.user?.id&&<Link className="btn outline sm" href={`/admin/users/${row.user.id}`}>View profile & students</Link>}{row.verified?<button className="btn outline sm danger" disabled={busy===row.id} onClick={()=>void decide(row,"REVOKE")}>Revoke approval</button>:<><button className="btn sm" disabled={busy===row.id} onClick={()=>void decide(row,"APPROVE")}>{busy===row.id?"Saving…":"Approve"}</button><button className="btn outline sm danger" disabled={busy===row.id} onClick={()=>void decide(row,"REJECT")}>Reject</button></>}</div></article>)}{!rows.length&&!error&&<div className="card emptyState"><h2>No matching institutions</h2><p className="muted">Adjust the filters or wait for a new registration.</p></div>}</div>
  </main></Page>
}
