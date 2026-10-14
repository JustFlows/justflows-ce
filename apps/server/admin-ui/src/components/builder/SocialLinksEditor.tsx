// SPDX-License-Identifier: MIT
import { useT } from "../../i18n/I18nProvider";
interface Link { label: string; url: string; icon: string }
export default function SocialLinksEditor({ value, onChange }: { value: unknown; onChange: (links: Link[]) => void }) {
  const { t } = useT();
  const links: Link[] = Array.isArray(value) ? value.slice(0, 30).map(raw => ({ label: String(raw?.label || ""), url: String(raw?.url || ""), icon: String(raw?.icon || "link") })) : [];
  const patch = (index: number, changes: Partial<Link>) => onChange(links.map((link, i) => i === index ? { ...link, ...changes } : link));
  return <div>{links.map((link, i) => <fieldset key={i} style={{ marginBottom: 12 }}>
    <legend>{t("builder.functional.profile", { index: i + 1 })}</legend>
    <label>{t("builder.functional.fields.label")}<input value={link.label} onChange={event => patch(i, { label: event.target.value })} /></label>
    <label>{t("builder.functional.fields.src")}<input type="url" value={link.url} onChange={event => patch(i, { url: event.target.value })} /></label>
    <label>{t("builder.functional.fields.name")}<select value={link.icon} onChange={event => patch(i, { icon: event.target.value })}>{["link", "facebook", "instagram", "linkedin", "youtube", "tiktok", "x", "github", "mastodon"].map(icon => <option key={icon}>{icon}</option>)}</select></label>
    <button type="button" onClick={() => onChange(links.filter((_, index) => index !== i))}>{t("builder.functional.removeProfile")}</button>
    <button type="button" disabled={i === 0} onClick={() => { const next = [...links]; [next[i - 1], next[i]] = [next[i]!, next[i - 1]!]; onChange(next); }}>{t("builder.functional.moveProfileUp")}</button>
  </fieldset>)}<button type="button" disabled={links.length >= 30} onClick={() => onChange([...links, { label: "", url: "", icon: "link" }])}>{t("builder.functional.addProfile")}</button></div>;
}
