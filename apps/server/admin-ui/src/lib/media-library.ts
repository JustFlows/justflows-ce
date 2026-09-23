export interface MediaLibraryItem {
  url: string;
  filename: string;
}

function isImageItem(item: Record<string, unknown>): boolean {
  const mime = String(item.mimeType ?? item.mime_type ?? "");
  const url = String(item.url ?? "");
  return Boolean(url) && mime.startsWith("image/");
}

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/media", { method: "POST", body: form });
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
  return data.url;
}

export async function loadImageLibrary(): Promise<MediaLibraryItem[]> {
  const res = await fetch("/api/media?limit=80");
  const body = (await res.json()) as { items?: Array<Record<string, unknown>> };
  return (body.items ?? []).filter(isImageItem).map((item) => ({
    url: String(item.url),
    filename: String(item.filename ?? item.url),
  }));
}
