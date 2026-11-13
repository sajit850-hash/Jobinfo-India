"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PdfDocument = { numPages: number; getPage(page: number): Promise<any> };

export function ResumeViewer({ candidateId }: { candidateId: string }) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pdfRef = useRef<PdfDocument | null>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [documentText, setDocumentText] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [fitPage, setFitPage] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);

  const renderPages = useCallback(async (document: PdfDocument, scale: number, pageFit: boolean, forceAll = false) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const oldScroll = viewer.scrollTop;
    observerRef.current?.disconnect();
    viewer.replaceChildren();
    const ratio = forceAll ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(260, viewer.clientWidth - 36);
      let displayScale = availableWidth / base.width * scale;
      if (pageFit) displayScale = Math.min(displayScale, Math.max(220, viewer.clientHeight - 36) / base.height);
      const viewport = page.getViewport({ scale: displayScale });
      const wrapper = window.document.createElement("div");
      wrapper.className = "resumePdfPage";
      wrapper.dataset.page = String(pageNumber);
      wrapper.style.width = `${viewport.width}px`;
      const canvas = window.document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.dataset.rendered = "false";
      wrapper.appendChild(canvas);
      const label = window.document.createElement("span");
      label.className = "resumePdfPageLabel";
      label.textContent = `Page ${pageNumber} of ${document.numPages}`;
      wrapper.appendChild(label);
      viewer.appendChild(wrapper);
    }
    viewer.scrollTop = oldScroll;
    const renderPage = async (wrapper: HTMLElement) => {
      const canvas = wrapper.querySelector("canvas");
      if (!canvas || canvas.dataset.rendered === "true" || canvas.dataset.rendering === "true") return;
      canvas.dataset.rendering = "true";
      try {
        const pageNumber = Number(wrapper.dataset.page);
        const page = await document.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const displayScale = Number.parseFloat(canvas.style.width) / base.width;
        const viewport = page.getViewport({ scale: displayScale });
        canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
        const context = canvas.getContext("2d");
        if (context) await page.render({ canvasContext: context, viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] }).promise;
        if (wrapper.isConnected) canvas.dataset.rendered = "true";
      } finally { canvas.dataset.rendering = "false"; }
    };
    if (forceAll) {
      await Promise.all([...viewer.querySelectorAll<HTMLElement>("[data-page]")].map(wrapper => renderPage(wrapper)));
    } else if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        const wrapper = entry.target as HTMLElement; const canvas = wrapper.querySelector("canvas");
        if (!canvas) return;
        if (entry.isIntersecting) void renderPage(wrapper).catch(() => undefined);
        else if (canvas.dataset.rendered === "true") { canvas.width = 1; canvas.height = 1; canvas.dataset.rendered = "false"; }
      }), { root: viewer, rootMargin: "100% 0px" });
      observerRef.current = observer;
      viewer.querySelectorAll<HTMLElement>("[data-page]").forEach(page => observer.observe(page));
    } else {
      for (const wrapper of [...viewer.querySelectorAll<HTMLElement>("[data-page]")].slice(0, 3)) await renderPage(wrapper);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadedPdf: PdfDocument | null = null;
    setLoading(true); setError(""); setDocumentText(""); setPdf(null); pdfRef.current = null;
    fetch(`/api/v1/recruiters/candidates/${encodeURIComponent(candidateId)}/resume/preview`, { credentials: "include", cache: "no-store" })
      .then(async response => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Resume preview is unavailable");
        }
        const type = response.headers.get("content-type") || "";
        const disposition = response.headers.get("content-disposition") || "";
        const dispositionName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
        if (type.includes("application/json")) {
          const payload = await response.json();
          if (!cancelled) { setDocumentText(payload.text || ""); setFileName(payload.fileName || "Resume document"); }
          return;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        loadedPdf = await pdfjs.getDocument({ data: bytes }).promise as unknown as PdfDocument;
        if (cancelled) { await (loadedPdf as any).destroy?.(); return; }
        pdfRef.current = loadedPdf; setPdf(loadedPdf); setFileName(dispositionName || "Candidate resume");
      })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load resume preview"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; if (loadedPdf) void (loadedPdf as any).destroy?.(); };
  }, [candidateId]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    const timer = window.setTimeout(() => { void renderPages(pdf, zoom, fitPage).catch(() => { if (!cancelled) setError("Some resume pages could not be rendered."); }); }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [pdf, zoom, fitPage, renderPages, fullscreen, layoutVersion]);

  useEffect(() => { const resize = () => setLayoutVersion(value => value + 1); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !pdf) return;
    const updatePage = () => {
      const pages = [...viewer.querySelectorAll<HTMLElement>("[data-page]")];
      const middle = viewer.scrollTop + viewer.clientHeight / 3;
      const current = pages.find(page => page.offsetTop + page.offsetHeight > middle);
      if (current) setCurrentPage(Number(current.dataset.page));
    };
    viewer.addEventListener("scroll", updatePage, { passive: true });
    updatePage();
    return () => viewer.removeEventListener("scroll", updatePage);
  }, [pdf]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const goToPage = (page: number) => {
    const target = viewerRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(page);
  };
  const print = async () => {
    document.body.classList.add("printResumeOnly");
    if (pdf) await renderPages(pdf, zoom, fitPage, true);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    window.print();
    if (pdf) await renderPages(pdf, zoom, fitPage);
    document.body.classList.remove("printResumeOnly");
  };

  return <section className={`card resumePreviewPanel${fullscreen ? " isFullscreen" : ""}`} id="candidate-resume-preview">
    <div className="resumePreviewHeader"><div><p className="eyebrow">CANDIDATE UPLOAD</p><h2>Resume Preview</h2><p className="muted">{fileName || "Private resume file"} · scroll inside this preview to read every page</p></div><span className="resumeFormatBadge">{pdf ? `PDF · ${pdf.numPages} pages` : documentText ? "DOC / DOCX text preview" : "Private file"}</span></div>
    <div className="resumeToolbar" role="toolbar" aria-label="Resume viewer controls">
      {pdf && <><button type="button" className="btn outline sm" onClick={()=>setZoom(value=>Math.max(.5,Math.round((value-.15)*100)/100))}>− Zoom out</button><span className="resumeZoomValue">{fitPage ? "Fit page" : `${Math.round(zoom*100)}%`}</span><button type="button" className="btn outline sm" onClick={()=>{setFitPage(false);setZoom(value=>Math.min(2.5,Math.round((value+.15)*100)/100));}}>+ Zoom in</button><button type="button" className="btn outline sm" onClick={()=>{setFitPage(false);setZoom(1);}}>Fit width</button><button type="button" className="btn outline sm" onClick={()=>setFitPage(true)}>Fit page</button><button type="button" className="btn outline sm" disabled={currentPage<=1} onClick={()=>goToPage(currentPage-1)}>Previous page</button><label className="resumePagePicker">Page<select value={currentPage} onChange={event=>goToPage(Number(event.target.value))}>{Array.from({length:pdf.numPages},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select> / {pdf.numPages}</label><button type="button" className="btn outline sm" disabled={currentPage>=pdf.numPages} onClick={()=>goToPage(currentPage+1)}>Next page</button></>}
      <button type="button" className="btn outline sm" onClick={()=>setFullscreen(value=>!value)}>{fullscreen?"Exit fullscreen":"Fullscreen"}</button>
      {pdf && <button type="button" className="btn outline sm" onClick={print}>Print</button>}
      <a className="btn outline sm" href={`/api/v1/recruiters/candidates/${encodeURIComponent(candidateId)}/resume`}>Download resume</a>
    </div>
    <div className={`resumeViewerScroll${documentText ? " isTextPreview" : ""}`} ref={viewerRef} aria-label="Scrollable resume document" tabIndex={0}>
      {loading && <p className="resumeViewerMessage">Loading the private resume from secure storage…</p>}
      {!loading && error && <div className="resumeViewerMessage err">{error}</div>}
      {!loading && documentText && <pre className="resumeTextDocument">{documentText}</pre>}
      {!loading && !error && !documentText && !pdf && <p className="resumeViewerMessage">No resume was uploaded for this candidate.</p>}
    </div>
    <p className="resumePrivacyNote">Visible only to authorized recruiters for this candidate. Resume previews and downloads are recorded in the activity log.</p>
  </section>;
}
