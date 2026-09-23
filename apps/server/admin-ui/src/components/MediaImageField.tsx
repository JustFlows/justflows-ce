import { useRef, useState } from "react";
import { safeMediaSrc } from "@justflows/blocks";
import { loadImageLibrary, uploadImage, type MediaLibraryItem } from "../lib/media-library";

type MediaItem = MediaLibraryItem;

export default function MediaImageField({
  id,
  label,
  description,
  value,
  onChange,
  square = false,
}: {
  id: string;
  label: string;
  description?: string;
  value: string;
  onChange: (url: string) => void;
  square?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState<MediaItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function openLibrary() {
    setError("");
    setLibraryOpen(true);
    if (library) return;
    try {
      setLibrary(await loadImageLibrary());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLibrary([]);
    }
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const url = await uploadImage(file);
      onChange(url);
      setLibraryOpen(false);
      setLibrary((prev) => (prev ? [{ url, filename: file.name }, ...prev] : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function pick(url: string) {
    onChange(url);
    setLibraryOpen(false);
  }

  return (
    <div className="jf-field">
      <label className="jf-field__label" htmlFor={id}>{label}</label>
      {description ? <p className="jf-field__hint">{description}</p> : null}

      <div
        className={`jf-media-field__preview${square ? " jf-media-field__preview--square" : ""}`}
        data-empty={!value || undefined}
      >
        {value ? (
          <img src={safeMediaSrc(value)} alt="" />
        ) : (
          <span className="jf-field__hint">No image selected</span>
        )}
      </div>

      <div className="jf-row">
        <button type="button" className="jf-btn jf-btn--sm" onClick={openLibrary} disabled={busy}>
          {value ? "Select" : "Select image"}
        </button>
        <button
          type="button"
          className="jf-btn jf-btn--sm jf-btn--primary"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
        {value ? (
          <button type="button" className="jf-btn jf-btn--sm jf-btn--quiet" onClick={() => onChange("")}>
            Remove
          </button>
        ) : null}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/avif,image/svg+xml,image/x-icon,.ico,.svg"
        hidden
        onChange={(e) => void handleUpload(e.target.files?.[0])}
      />

      {error ? <p className="jf-field__hint" role="alert" style={{ color: "var(--jf-danger)" }}>{error}</p> : null}

      {libraryOpen ? (
        <div className="jf-media-library" role="listbox" aria-label="Media library">
          {library === null ? (
            <p className="jf-field__hint" style={{ gridColumn: "1 / -1" }}>Loading…</p>
          ) : library.length === 0 ? (
            <p className="jf-field__hint" style={{ gridColumn: "1 / -1" }}>
              No images yet. Upload one, or add files in Media.
            </p>
          ) : (
            library.map((item) => (
              <button
                key={item.url}
                type="button"
                className="jf-media-library__item"
                data-selected={item.url === value || undefined}
                title={item.filename}
                onClick={() => pick(item.url)}
              >
                <img src={safeMediaSrc(item.url)} alt="" />
              </button>
            ))
          )}
        </div>
      ) : null}

      <details>
        <summary className="jf-field__hint" style={{ cursor: "pointer" }}>Paste URL</summary>
        <input
          id={id}
          className="jf-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://… or /uploads/…"
        />
      </details>
    </div>
  );
}
