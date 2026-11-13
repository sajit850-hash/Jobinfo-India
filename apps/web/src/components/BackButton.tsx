"use client";

import { usePathname, useRouter } from "next/navigation";

function fallbackFor(pathname: string) {
  if (pathname.startsWith("/admin")) return "/admin/dashboard";
  if (pathname.startsWith("/candidate")) return "/candidate/dashboard";
  if (pathname.startsWith("/recruiter")) return "/recruiter/dashboard";
  if (pathname.startsWith("/institution")) return "/institution/dashboard";
  return "/jobs";
}

export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === "/") return null;

  return <div className="wrap backNavigation">
    <button className="backButton" type="button" onClick={() => {
      const appHistoryIndex = window.history.state?.idx;
      if (typeof appHistoryIndex === "number" && appHistoryIndex > 0) router.back();
      else router.push(fallbackFor(pathname));
    }}>
      <span aria-hidden="true">←</span> Back
    </button>
  </div>;
}
