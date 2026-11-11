"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { API } from "@/lib/api";

export default function InstitutionDirectory() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/api/v1/institutions?q=${encodeURIComponent(q)}`, { signal: controller.signal })
      .then((r) => r.json()).then((x) => setRows(x.data || [])).catch(() => {
        if (!controller.signal.aborted) setRows([]);
      });
    return () => controller.abort();
  }, [q]);

  return <Page><main className="wrap section">
    <div className="directoryHeading"><div><p className="eyebrow">INSTITUTION DIRECTORY</p><h1>Colleges and training partners</h1>
      <p className="muted">Explore verified colleges and training partners.</p></div>
      <Link className="btn" href="/institutions/register">Register institution</Link></div>
    <label className="directorySearch">Search institutions<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, city or state" /></label>
    <div className="grid3 directoryGrid">{rows.map((x) => <article className="card" key={x.id}><h2>{x.name}</h2>
      <p className="muted">{x.city}, {x.state}</p>{x.departments?.length > 0 && <p>{x.departments.map((d: { id: string; name: string }) => d.name).join(", ")}</p>}
    </article>)}</div>
    {!rows.length && <p className="muted">No verified institutions found.</p>}
  </main></Page>;
}
