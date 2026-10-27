// SPDX-License-Identifier: MIT
export function functionalBlockCss(): string {
  return `
.jf-list{padding-inline-start:1.5em}.jf-list-item{margin-block:var(--jf-list-gap,8px)}
.jf-list-check{display:none}.jf-list--checklist{list-style:none!important;padding-inline-start:0}
.jf-list--checklist>.jf-list-item{display:flex;align-items:baseline;gap:.6em}
.jf-list--checklist>.jf-list-item>.jf-list-check{display:inline-block}
.jf-list-item-content{min-width:0}.jf-list-item-content p{margin:0}
.jf-table-wrap{max-width:100%;overflow-x:auto;margin:0}.jf-table{width:100%;border-collapse:collapse}
.jf-table th,.jf-table td{padding:var(--jf-cell-padding,12px);text-align:inherit;overflow-wrap:anywhere}
.jf-table caption{text-align:start;padding:.5em 0;font-weight:600}
.jf-table--bordered th,.jf-table--bordered td{border:1px solid var(--color-border,#ddd)}
.jf-table--striped tbody tr:nth-child(even){background:var(--color-surface,#f6f6f6)}
.jf-details{border:1px solid var(--color-border,#ddd);border-radius:8px;padding:1em}
.jf-details summary{cursor:pointer;font-weight:600}.jf-details-content{padding-top:1em}
.jf-details--none summary,.jf-details--plus summary{list-style:none}
.jf-details--none summary::-webkit-details-marker,.jf-details--plus summary::-webkit-details-marker{display:none}
.jf-details--plus summary:before{content:'+';display:inline-block;width:1.5em}.jf-details--plus[open]>summary:before{content:'−'}
.jf-accordion{display:flex;flex-direction:column}
.jf-cover{position:relative;isolation:isolate;display:flex;flex-direction:column;padding:2em;overflow:hidden}
.jf-cover-media,.jf-cover-overlay{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.jf-cover-media{z-index:-2}.jf-cover-overlay{z-index:-1;pointer-events:none}
.jf-cover-content{position:relative;width:100%;min-width:0}.jf-cover-playback{position:absolute;bottom:12px;right:12px;z-index:2}
.jf-media-text{display:grid;grid-template-columns:minmax(0,var(--jf-media-width,50%)) minmax(0,1fr)}
.jf-media-text--right{grid-template-columns:minmax(0,1fr) minmax(0,var(--jf-media-width,50%))}
.jf-media-text--right>.jf-media-text-media{grid-column:2;grid-row:1}.jf-media-text--right>.jf-media-text-content{grid-column:1;grid-row:1}
.jf-media-text-media,.jf-media-text-content{min-width:0}.jf-media-text-media img,.jf-media-text-media video{display:block;width:100%;max-width:100%;height:auto}
.jf-card{display:flex;flex-direction:column;background:var(--color-surface,transparent)}
.jf-card--shadow-small{box-shadow:0 2px 8px #0001}.jf-card--shadow-medium{box-shadow:0 6px 20px #0002}.jf-card--shadow-large{box-shadow:0 12px 40px #0003}
.jf-icon{display:inline-flex;vertical-align:middle}.jf-icon svg{max-width:100%}
.jf-callout{display:flex;align-items:flex-start;gap:12px;padding:20px;border:1px solid;border-radius:8px}
.jf-callout-content{flex:1;min-width:0}.jf-callout-title{display:block;margin-bottom:.5em}.jf-callout-icon{font-size:1.4em;line-height:1}
.jf-callout--info{border-color:#60a5fa}.jf-callout--success{border-color:#4ade80}.jf-callout--warning{border-color:#fbbf24}.jf-callout--error{border-color:#f87171}.jf-callout--neutral{border-color:var(--color-border,#ddd)}
.jf-callout[hidden],.jf-tab[hidden]{display:none!important}
.jf-tablist{display:flex;gap:8px;overflow:auto;margin-bottom:16px}
.jf-tablist [role=tab]{padding:.75em 1em;border:1px solid var(--color-border,#ddd);background:transparent;color:inherit;cursor:pointer;border-radius:6px}
.jf-tablist [aria-selected=true]{background:var(--color-primary,#2563eb);color:var(--color-primary-contrast,#fff)}
.jf-tabs[data-jf-enhanced]>.jf-tab>.jf-tab-heading{display:none}
.jf-tabs[data-jf-enhanced][data-jf-orientation=vertical]{display:grid;grid-template-columns:minmax(120px,auto) minmax(0,1fr);gap:20px}
.jf-tabs[data-jf-orientation=vertical]>.jf-tablist{flex-direction:column}
.jf-tablist [role=tab]:focus-visible,.jf-details summary:focus-visible,.jf-callout button:focus-visible,.jf-cover-playback:focus-visible{outline:2px solid currentColor;outline-offset:3px}
.jf-navigation>ul:not(.jf-nav),.jf-navigation-desktop>ul{display:flex;flex-wrap:wrap;flex-direction:var(--jf-nav-direction,row);gap:var(--jf-nav-gap,16px);list-style:none;padding:0;margin:0}
.jf-navigation>.jf-nav{gap:var(--jf-nav-gap,16px)}
.jf-navigation li>ul{list-style:none;padding-inline-start:1em}.jf-navigation>details{display:none}
.jf-social-links a{display:inline-flex;align-items:center;gap:.4em}
.jf-breadcrumbs ol{list-style:none;display:flex;flex-wrap:wrap;gap:.5em;margin:0;padding:0}
.jf-content-query--grid{display:grid;grid-template-columns:repeat(var(--jf-query-columns,3),minmax(0,1fr));gap:24px}
.jf-content-query article{min-width:0}.jf-content-query img{max-width:100%;height:auto}.jf-content-query--list article+article{margin-top:24px}
.jf-query-pagination{display:flex;gap:16px;margin-top:24px}.jf-toc li{margin-block:.4em}.jf-toc[hidden]{display:none!important}
@media(max-width:640px){.jf-navigation--collapse>details{display:block}.jf-navigation--collapse>.jf-navigation-desktop{display:none}.jf-content-query--grid{grid-template-columns:minmax(0,1fr)}.jf-media-text--stack{grid-template-columns:minmax(0,1fr)}.jf-media-text--stack>.jf-media-text-media,.jf-media-text--stack>.jf-media-text-content{grid-column:auto;grid-row:auto}.jf-tabs[data-jf-enhanced][data-jf-orientation=vertical]{grid-template-columns:minmax(0,1fr)}.jf-tabs[data-jf-orientation=vertical]>.jf-tablist{flex-direction:row}}
`;
}
