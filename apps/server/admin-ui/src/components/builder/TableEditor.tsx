// SPDX-License-Identifier: MIT
import { useT } from "../../i18n/I18nProvider";
export default function TableEditor({ value, onChange }: { value: unknown; onChange: (rows: string[][]) => void }) {
  const { t } = useT();
  const rows = Array.isArray(value) ? value.slice(0, 100).map(row => Array.isArray(row) ? row.slice(0, 20).map(cell => String(cell ?? "")) : []) : [];
  const width = Math.max(1, ...rows.map(row => row.length));
  const normalized = rows.map(row => Array.from({ length: width }, (_, col) => row[col] || ""));
  return <div className="jf-block-panel__field">
    <span>{t("builder.functional.tableCells")}</span>
    <div style={{ overflow: "auto", maxHeight: 400 }}>
      <table><thead><tr>{Array.from({ length: width }, (_, col) => <th key={col}>
        <button type="button" disabled={width <= 1} aria-label={t("builder.functional.removeColumn", { column: col + 1 })} onClick={() => onChange(normalized.map(row => row.filter((_, index) => index !== col)))}>− {col + 1}</button>
      </th>)}<th /></tr></thead><tbody>
        {normalized.map((row, index) => <tr key={index}>{row.map((cell, col) => <td key={col}><input style={{ minWidth: 90, width: "100%" }} aria-label={t("builder.functional.cell", { row: index + 1, column: col + 1 })} value={cell} onChange={event => onChange(normalized.map((other, ri) => ri === index ? other.map((v, ci) => ci === col ? event.target.value : v) : other))} /></td>)}<td>
          <button type="button" aria-label={t("builder.functional.removeRow", { row: index + 1 })} onClick={() => onChange(normalized.filter((_, ri) => ri !== index))}>×</button>
          <button type="button" disabled={index === 0} aria-label={t("builder.functional.moveRowUp", { row: index + 1 })} onClick={() => { const next = [...normalized]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; onChange(next); }}>↑</button>
          <button type="button" disabled={index === normalized.length - 1} aria-label={t("builder.functional.moveRowDown", { row: index + 1 })} onClick={() => { const next = [...normalized]; [next[index + 1], next[index]] = [next[index]!, next[index + 1]!]; onChange(next); }}>↓</button>
        </td></tr>)}
      </tbody></table>
    </div>
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" disabled={rows.length >= 100} onClick={() => onChange([...normalized, Array(width).fill("")])}>{t("builder.functional.addRow")}</button>
      <button type="button" disabled={width >= 20} onClick={() => onChange(normalized.length ? normalized.map(row => [...row, ""]) : [["", ""]])}>{t("builder.functional.addColumn")}</button>
    </div>
  </div>;
}
