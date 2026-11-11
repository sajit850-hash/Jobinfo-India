"use client";
import { useState } from "react";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";
export default function InstitutionRegister(){const [msg,setMsg]=useState("");const [err,setErr]=useState("");async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);const r=await api("/api/v1/institutions/register",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});if(!r.ok)setErr(r.data.error||"Registration failed");else setMsg("Institution submitted for verification. You can now log in.");}
return <Page><main className="wrap section"><div className="formCard"><h1>Institution registration</h1>{err&&<div className="err">{err}</div>}{msg&&<div className="info">{msg}</div>}<form onSubmit={submit}>{["contactName","email","password","name","city","state","website"].map(k=><label className="field" key={k}>{k}<input name={k} type={k==="email"?"email":k==="password"?"password":"text"} required={!["website"].includes(k)} minLength={k==="password"?10:undefined}/></label>)}<button className="btn block">Submit for verification</button></form></div></main></Page>}
