"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Notification = { id: string; title: string; body: string; readAt: string | null; createdAt: string };

export function NotificationsMenu() {
  const [signedIn, setSignedIn] = useState(false);
  const [rows, setRows] = useState<Notification[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void api<{ user: { id: string } | null }>("/api/v1/auth/me").then((result) => {
      if (active) setSignedIn(result.ok && !!result.data.user);
    });
    return () => { active = false; };
  }, []);

  async function load() {
    const result = await api<{ data: Notification[] }>("/api/v1/notifications");
    if (result.ok) { setRows(result.data.data); setError(""); }
    else setError(result.data.error || "Could not load notifications");
  }

  async function markRead(id: string) {
    const result = await api(`/api/v1/notifications/${id}/read`, { method: "PATCH" });
    if (result.ok) setRows((current) => current.map((row) => row.id === id ? { ...row, readAt: new Date().toISOString() } : row));
    else setError(result.data.error || "Could not update notification");
  }

  if (!signedIn) return null;
  const unread = rows.filter((row) => !row.readAt).length;
  return <details className="notificationMenu" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
    <summary aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>Notifications{unread > 0 && <span className="notificationCount">{unread > 99 ? "99+" : unread}</span>}</summary>
    <section className="notificationPanel" aria-label="Your notifications">
      <h2>Notifications</h2>
      {error && <p className="err">{error}</p>}
      {!rows.length && !error && <p className="muted">No notifications yet.</p>}
      {rows.map((row) => <article className={`notificationRow${row.readAt ? " isRead" : ""}`} key={row.id}>
        <div><b>{row.title}</b><p>{row.body}</p><small>{new Date(row.createdAt).toLocaleString()}</small></div>
        {!row.readAt && <button type="button" className="textLink" onClick={() => void markRead(row.id)}>Mark read</button>}
      </article>)}
    </section>
  </details>;
}
