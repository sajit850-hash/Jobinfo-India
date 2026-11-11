"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

export function Portal({ title, endpoint, links = [] }: { title: string; endpoint: string; links?: { label: string; href: string }[] }) {
  const [data,setData]=useState<unknown>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  useEffect(()=>{ let live=true; api(endpoint).then(r=>{if(!live)return;setLoading(false);if(!r.ok)setError(r.data.error||"Unable to load this dashboard");else setData(r.data);});return()=>{live=false};},[endpoint]);
  return <Page><main className="wrap section">
    <div className="row2" style={{alignItems:"center",justifyContent:"space-between"}}><div><p className="eyebrow">JOBINFO INDIA PORTAL</p><h1>{title}</h1></div><Link className="btn outline" href="/">Back to website</Link></div>
    <div className="grid3" style={{margin:"24px 0"}}>{links.map(x=><Link className="card" key={x.href} href={x.href}><b>{x.label} →</b></Link>)}</div>
    <div className="card"><h2>Workspace overview</h2>{loading?<p>Loading your workspace…</p>:error?<div className="err">{error}. Please sign in with the correct account.</div>:<pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(data,null,2)}</pre>}</div>
  </main></Page>;
}
