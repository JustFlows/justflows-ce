import { useRef, useState } from "react";

interface MediaItem {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  width?: number;
  height?: number;
  uploadedAt: string;
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

export default function MediaPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/media", { method: "POST", body: form });
      const data = await res.json() as MediaItem & { error?: string };
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

  return (
    <div className="jf-page">
      <header className="jf-pagehead">
        <div className="jf-pagehead__text">
          <h1>Media Library</h1>
          <p>{items.length} {items.length === 1 ? "file" : "files"}</p>
        </div>
        <div className="jf-pagehead__actions">
          <button className="jf-btn jf-btn--primary" onClick={() => inputRef.current?.click()}>
            Upload files
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*,application/pdf"
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); }}
        />
      </header>

      <div
        className="jf-dropzone"
        data-dragging={dragging}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
        }}
      >
        {uploading ? "Uploading…" : "Drop files here to upload"}
      </div>

      {error && <div className="jf-alert jf-alert--error" role="alert">{error}</div>}

      {items.length === 0 ? (
        <div className="jf-card">
          <div className="jf-empty">
            <span className="jf-empty__icon" aria-hidden="true">🖼</span>
            <span className="jf-empty__title">No files yet</span>
            <p>Upload images, video, audio or PDFs to use them across your site.</p>
          </div>
        </div>
      ) : (
        <div className="jf-cardgrid jf-cardgrid--sm">
          {items.map((item) => (
            <div key={item.id} className="jf-card">
              <div className="jf-thumb jf-thumb--sm">
                {item.mimeType.startsWith("image/") ? (
                  <img src={item.url} alt={item.filename} />
                ) : (
                  <span aria-hidden="true">{iconFor(item.mimeType)}</span>
                )}
              </div>
              <div style={{ padding: "0.55rem 0.75rem" }}>
                <p className="jf-truncate" style={{ margin: 0, fontSize: "0.78rem", fontWeight: 600 }}>
                  {item.filename}
                </p>
                <p style={{ margin: "0.1rem 0 0", fontSize: "0.72rem", color: "var(--jf-text-3)" }}>
                  {formatBytes(item.sizeBytes)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
