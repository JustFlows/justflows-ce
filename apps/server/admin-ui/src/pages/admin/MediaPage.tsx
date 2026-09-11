import { useEffect, useRef, useState, type MouseEvent } from "react";

interface MediaItem {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  width?: number | null;
  height?: number | null;
  altText?: string | null;
  caption?: string | null;
  focalX?: number | null;
  focalY?: number | null;
  hasVariants?: boolean;
  uploadedAt: string;
}

interface RegenerateStatus {
  running: boolean;
  total: number;
  processed: number;
  skipped: number;
  failed: number;
  finishedAt: string | null;
  currentFile: string | null;
  errors: string[];
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function iconFor(mimeType: string) {
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType === "application/pdf") return "📄";
  return "📎";
}

function isImage(mimeType: string) {
  return mimeType.startsWith("image/") && mimeType !== "image/svg+xml";
}

export default function MediaPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [regen, setRegen] = useState<RegenerateStatus | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/media");
        const data = (await res.json()) as { items?: MediaItem[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to load media");
        setItems(data.items ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function uploadFile(file: File) {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/media", { method: "POST", body: form });
      const data = (await res.json()) as MediaItem & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setItems((i) => [data, ...i]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function uploadFiles(files: FileList) {
    for (const f of Array.from(files)) await uploadFile(f);
  }

  async function trash(item: MediaItem) {
    if (!confirm(`Move “${item.filename}” to trash?`)) return;
    const res = await fetch(`/api/media/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Could not trash media");
      return;
    }
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    setSelected((s) => (s?.id === item.id ? null : s));
  }

  function pollRegen() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/media/regenerate/status");
        if (!res.ok) return;
        const status = (await res.json()) as RegenerateStatus;
        setRegen(status);
        if (!status.running) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setRegenBusy(false);
          // Refresh the grid so the "Responsive" badges update.
          const list = await fetch("/api/media");
          if (list.ok) setItems(((await list.json()) as { items?: MediaItem[] }).items ?? []);
        }
      } catch {
        // keep polling
      }
    }, 1500);
  }

  async function regenerateAll() {
    setError("");
    setRegenBusy(true);
    try {
      const res = await fetch("/api/media/regenerate", { method: "POST" });
      const data = (await res.json()) as RegenerateStatus & { error?: string; started?: boolean };
      if (res.status === 403) throw new Error("Only administrators can regenerate the library");
      if (!res.ok && res.status !== 409)
        throw new Error(data.error ?? "Could not start regeneration");
      setRegen(data);
      pollRegen();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRegenBusy(false);
    }
  }

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Media Library</h1>
          <p>{loading ? "…" : `${items.length} ${items.length === 1 ? "file" : "files"}`}</p>
        </div>
        <div className="jf-pagehead__actions">
          <button className="jf-btn jf-btn--primary" onClick={() => inputRef.current?.click()}>
            Upload files
          </button>
          <button
            className="jf-btn jf-btn--ghost"
            onClick={() => void regenerateAll()}
            disabled={regenBusy}
            title="Rebuild resized variants and WebP/AVIF for every image with the current settings"
          >
            {regenBusy ? "Regenerating…" : "↻ Regenerate responsive images"}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*,application/pdf"
          aria-label="Choose files to upload"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) uploadFiles(e.target.files);
          }}
        />
      </header>

      {regen && (regen.running || regen.finishedAt) && (
        <div className={`jf-alert ${regen.failed > 0 ? "jf-alert--error" : "jf-alert--success"}`}>
          {regen.running ? (
            <span>
              Regenerating… {regen.processed + regen.skipped + regen.failed}/{regen.total}
              {regen.currentFile ? ` — ${regen.currentFile}` : ""}
            </span>
          ) : (
            <span>
              ✓ Regeneration finished: {regen.processed} rebuilt, {regen.skipped} skipped,{" "}
              {regen.failed} failed.
            </span>
          )}
          {regen.errors.length > 0 && (
            <ul style={{ margin: "0.4rem 0 0", paddingInlineStart: "1.1rem", fontSize: "0.8rem" }}>
              {regen.errors.slice(0, 8).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div
        className="jf-dropzone"
        data-dragging={dragging}
        role="button"
        tabIndex={0}
        aria-label="Upload files. Drop files here or press Enter to browse."
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        {uploading ? "Uploading…" : "Drop files here to upload"}
      </div>

      {error && (
        <div className="jf-alert jf-alert--error" role="alert">
          {error}
        </div>
      )}

      {loading ? null : items.length === 0 ? (
        <div className="jf-card">
          <div className="jf-empty">
            <span className="jf-empty__icon" aria-hidden="true">
              🖼
            </span>
            <span className="jf-empty__title">No files yet</span>
            <p>Upload images, video, audio or PDFs to use them across your site.</p>
          </div>
        </div>
      ) : (
        <div className="jf-cardgrid jf-cardgrid--sm">
          {items.map((item) => (
            <div key={item.id} className="jf-card">
              <button
                type="button"
                className="jf-thumb jf-thumb--sm"
                style={{ border: 0, cursor: "pointer", width: "100%" }}
                onClick={() => (isImage(item.mimeType) ? setSelected(item) : undefined)}
                aria-label={`Edit ${item.filename}`}
              >
                {item.mimeType.startsWith("image/") ? (
                  <img src={item.url} alt={item.filename} />
                ) : (
                  <span aria-hidden="true">{iconFor(item.mimeType)}</span>
                )}
              </button>
              <div style={{ padding: "0.55rem 0.75rem" }}>
                <p
                  className="jf-truncate"
                  style={{ margin: 0, fontSize: "0.78rem", fontWeight: 600 }}
                >
                  {item.filename}
                </p>
                <p style={{ margin: "0.1rem 0 0", fontSize: "0.72rem", color: "var(--jf-text-3)" }}>
                  {formatBytes(item.sizeBytes)}
                  {item.width && item.height ? ` · ${item.width}×${item.height}` : ""}
                </p>
                <div className="jf-row" style={{ gap: "0.35rem", marginTop: "0.35rem" }}>
                  {isImage(item.mimeType) && (
                    <span
                      className={`jf-badge jf-badge--${item.hasVariants ? "ok" : "warn"}`}
                      style={{ fontSize: "0.66rem" }}
                    >
                      {item.hasVariants ? "Responsive" : "Original only"}
                    </span>
                  )}
                </div>
                <div className="jf-row" style={{ gap: "0.35rem", marginTop: "0.35rem" }}>
                  {isImage(item.mimeType) && (
                    <button
                      type="button"
                      className="jf-btn jf-btn--ghost jf-btn--sm"
                      onClick={() => setSelected(item)}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="jf-btn jf-btn--ghost jf-btn--sm"
                    onClick={() => void trash(item)}
                  >
                    Trash
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <MediaDetailDialog
          key={selected.id}
          item={selected}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setItems((list) => list.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)));
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

function MediaDetailDialog({
  item,
  onClose,
  onSaved,
}: {
  item: MediaItem;
  onClose: () => void;
  onSaved: (updated: MediaItem) => void;
}) {
  const [alt, setAlt] = useState(item.altText ?? "");
  const [caption, setCaption] = useState(item.caption ?? "");
  const [focalX, setFocalX] = useState(item.focalX ?? 0.5);
  const [focalY, setFocalY] = useState(item.focalY ?? 0.5);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [detailLoaded, setDetailLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/media/${item.id}`);
        if (!res.ok) return;
        const data = (await res.json()) as MediaItem;
        setAlt(data.altText ?? "");
        setCaption(data.caption ?? "");
        if (data.focalX != null) setFocalX(data.focalX);
        if (data.focalY != null) setFocalY(data.focalY);
      } catch {
        // fall back to the list row values
      } finally {
        setDetailLoaded(true);
      }
    })();
  }, [item.id]);

  function setFocalFromEvent(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setFocalX(Number(x.toFixed(4)));
    setFocalY(Number(y.toFixed(4)));
  }

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch(`/api/media/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ altText: alt, caption, focalX, focalY }),
      });
      const data = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok || data.error) throw new Error(data.error ?? "Could not save");
      onSaved({ ...item, altText: alt, caption, focalX, focalY });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${item.filename}`}
      className="jf-media-detail__backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="jf-media-detail">
        <div className="jf-card__head">
          <h2 className="jf-card__title jf-truncate">{item.filename}</h2>
          <button type="button" className="jf-btn jf-btn--ghost jf-btn--sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="jf-card__body jf-stack">
          <p className="jf-field__hint">
            Click the image to set the focal point — art-directed crops (thumbnails and{" "}
            <code className="jf-code">object-fit: cover</code> boxes) keep this point in view.
            Saving a new focal point rebuilds this image’s variants.
          </p>
          <div
            className="jf-media-detail__stage"
            onClick={setFocalFromEvent}
            style={{ cursor: "crosshair" }}
          >
            <img src={item.url} alt="" />
            <span
              className="jf-media-detail__focal"
              style={{ left: `${focalX * 100}%`, top: `${focalY * 100}%` }}
              aria-hidden="true"
            />
          </div>
          <p className="jf-field__hint">
            Focal point: {(focalX * 100).toFixed(0)}% / {(focalY * 100).toFixed(0)}%
            {item.width && item.height ? ` — original ${item.width}×${item.height}` : ""}
            {"  "}
            <button
              type="button"
              className="jf-btn jf-btn--ghost jf-btn--sm"
              onClick={() => {
                setFocalX(0.5);
                setFocalY(0.5);
              }}
            >
              Reset to centre
            </button>
          </p>

          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-media-alt">
              Alt text
            </label>
            <input
              id="jf-media-alt"
              className="jf-input"
              value={alt}
              maxLength={2000}
              disabled={!detailLoaded}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="Describe the image for screen readers and search engines"
            />
          </div>
          <div className="jf-field">
            <label className="jf-field__label" htmlFor="jf-media-caption">
              Caption
            </label>
            <input
              id="jf-media-caption"
              className="jf-input"
              value={caption}
              maxLength={2000}
              disabled={!detailLoaded}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>

          {err && <p className="jf-status jf-status--error">{err}</p>}
          <div className="jf-row">
            <button
              className="jf-btn jf-btn--primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="jf-btn jf-btn--ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
