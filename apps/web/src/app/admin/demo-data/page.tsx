"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { api } from "@/lib/api";

type Batch = { id: string; batchKey: string; label: string; status: string; createdAt: string; _count: { records: number } };
type DemoRecord = { id: string; recordType: string; recordId: string; userId: string | null; createdAt: string };
type DemoUser = { id: string; fullName: string; email: string; role: string; isActive: boolean; employer?: { name: string; company?: { name: string } | null } | null; institution?: { name: string } | null };

export default function AdminDemoDataPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selected, setSelected] = useState("");
  const [records, setRecords] = useState<DemoRecord[]>([]);
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [role, setRole] = useState("");
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  async function loadBatches() {
    const result = await api<{ batches: Batch[] }>("/api/v1/admin/demo-data/batches");
    if (!result.ok) { setError(result.data.error || "Could not load demo batches"); return; }
    setBatches(result.data.batches);
    setSelected(current => result.data.batches.some(batch => batch.id === current) ? current : result.data.batches[0]?.id || "");
    setError("");
  }
  useEffect(() => { void loadBatches(); }, []);
  useEffect(() => {
    if (!selected) { setRecords([]); setUsers([]); return; }
    void api<{ records: DemoRecord[] }>(`/api/v1/admin/demo-data/batches/${selected}/records`).then(result => result.ok ? setRecords(result.data.records) : setError(result.data.error || "Could not load batch records"));
  }, [selected]);
  useEffect(() => {
    if (!selected) { setUsers([]); return; }
    const params = new URLSearchParams(); if (role) params.set("role", role); if (query.trim()) params.set("q", query.trim());
    void api<{ users: DemoUser[] }>(`/api/v1/admin/demo-data/batches/${selected}/users?${params}`).then(result => result.ok ? setUsers(result.data.users) : setError(result.data.error || "Could not load demo users"));
  }, [selected, role, query]);
  const selectedBatch = batches.find(batch => batch.id === selected);
  async function removeUser(user: DemoUser) {
    if (!window.confirm(`Delete ${user.fullName} and their demo-only profile data?`)) return;
    const typed = window.prompt(`Type this user ID to confirm: ${user.id}`);
    if (typed !== user.id) return;
    setBusy(user.id);
    const result = await api(`/api/v1/admin/demo-data/users/${user.id}`, { method: "DELETE", body: JSON.stringify({ confirmUserId: typed }) });
    setBusy("");
    if (!result.ok) { setError(result.data.error || "Could not delete demo user"); return; }
    setUsers(current => current.filter(row => row.id !== user.id));
    const refreshed = await api<{ records: DemoRecord[] }>(`/api/v1/admin/demo-data/batches/${selected}/records`);
    if (refreshed.ok) setRecords(refreshed.data.records);
  }
  async function removeBatch() {
    if (!selectedBatch || confirm !== selectedBatch.batchKey) return;
    setBusy(selectedBatch.id);
    const result = await api(`/api/v1/admin/demo-data/batches/${selectedBatch.id}`, { method: "DELETE", body: JSON.stringify({ confirmBatchKey: confirm }) });
    setBusy("");
    if (!result.ok) { setError(result.data.error || "Could not delete batch"); return; }
    setConfirm(""); setRecords([]); setUsers([]); setSelected(""); await loadBatches();
  }
  const counts = records.reduce<Record<string, number>>((out, row) => { out[row.recordType] = (out[row.recordType] || 0) + 1; return out; }, {});
  return <Page><main className="wrap section adminWorkspace"><div className="sectionTitle"><div><p className="eyebrow">STAGING DATA</p><h1>Demo data management</h1><p className="muted">Inspect, search and remove records owned by tracked demo batches.</p></div><Link className="btn outline" href="/admin/dashboard">Dashboard</Link></div>{error && <div className="err">{error}</div>}
    <section className="card adminDashSection"><label className="field">Seed batch<select value={selected} onChange={event => { setSelected(event.target.value); setConfirm(""); }}><option value="">Select a batch</option>{batches.map(batch => <option value={batch.id} key={batch.id}>{batch.label} · {batch.status}</option>)}</select></label>{!batches.length && <p className="muted">No tracked demo batches yet. Seed only a development or authorized staging database with DEMO_DATA_ENABLED=true.</p>}</section>
    {selectedBatch && <><div className="grid3 adminStats">{Object.entries(counts).map(([type, count]) => <article className="card adminStat" key={type}><span className="muted">{type}</span><strong>{count}</strong></article>)}<article className="card adminStat"><span className="muted">Batch status</span><strong>{selectedBatch.status}</strong></article></div>
      <section className="card adminDashSection"><h2>Demo accounts ({users.length})</h2><div className="adminFilters"><label className="field">Account type<select value={role} onChange={event => setRole(event.target.value)}><option value="">All account types</option><option value="CANDIDATE">Candidates</option><option value="RECRUITER">Recruiters</option><option value="INSTITUTION">Institutions</option><option value="ADMIN">Admins</option></select></label><label className="field">Search by ID, name or email<input value={query} onChange={event => setQuery(event.target.value)} /></label></div><div className="adminTableWrap"><table className="adminTable"><thead><tr><th>User ID</th><th>Account</th><th>Type / organization</th><th>State</th><th>Action</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td>{user.id}</td><td><b>{user.fullName}</b><small>{user.email}</small></td><td>{user.role}<small>{user.employer?.company?.name || user.employer?.name || user.institution?.name || ""}</small></td><td>{user.isActive ? "Active" : "Inactive"}</td><td><button className="btn outline sm danger" disabled={busy === user.id || selectedBatch.status !== "ACTIVE"} onClick={() => void removeUser(user)}>{busy === user.id ? "Deleting…" : "Delete demo account"}</button></td></tr>)}</tbody></table>{!users.length && <p className="muted adminEmpty">No demo users match this filter.</p>}</div></section>
      <section className="card adminDashSection"><h2>Tracked demo records</h2><div className="adminTableWrap"><table className="adminTable"><thead><tr><th>Type</th><th>Record ID</th><th>Associated user ID</th><th>Created</th></tr></thead><tbody>{records.map(row => <tr key={row.id}><td>{row.recordType}</td><td>{row.recordId}</td><td>{row.userId || "—"}</td><td>{new Date(row.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div><p className="muted">{records.length} active records in this batch.</p></section>
      {selectedBatch.status === "ACTIVE" && <section className="card adminDashSection"><h2>Delete this demo batch</h2><p className="muted">This permanently removes demo-owned accounts, profiles, jobs, student data, and dependent records. Deletion is refused if the batch has links to non-demo records. Your current admin account cannot be deleted as part of its own request.</p><label className="field">Type <code>{selectedBatch.batchKey}</code> to confirm<input value={confirm} onChange={event => setConfirm(event.target.value)} /></label><button className="btn danger" disabled={busy === selectedBatch.id || confirm !== selectedBatch.batchKey} onClick={() => void removeBatch()}>{busy === selectedBatch.id ? "Deleting…" : "Delete demo batch"}</button></section>}</>}
  </main></Page>;
}
