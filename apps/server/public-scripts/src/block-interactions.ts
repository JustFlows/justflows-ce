// SPDX-License-Identifier: MIT
let sequence = 0;

export function enhanceBlocks(root: ParentNode = document): void {
  for (const accordion of root.querySelectorAll<HTMLElement>('.jf-accordion[data-jf-exclusive="true"]')) {
    if (accordion.dataset.jfEnhanced) continue;
    accordion.dataset.jfEnhanced = "true";
    const panels = Array.from(accordion.querySelectorAll<HTMLDetailsElement>("details")).filter(panel => panel.closest('.jf-accordion') === accordion);
    let first = true;
    for (const panel of panels) {
      if (panel.open) { if (!first) panel.open = false; first = false; }
    }
    accordion.addEventListener("toggle", event => {
      const opened = event.target as HTMLDetailsElement;
      if (!opened.open || !panels.includes(opened)) return;
      for (const panel of panels) if (panel !== opened) panel.open = false;
    }, true);
  }
  for (const group of root.querySelectorAll<HTMLElement>('.jf-tabs')) {
    if (group.dataset.jfEnhanced) continue;
    const panels = Array.from(group.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('jf-tab'));
    if (!panels.length) continue;
    group.dataset.jfEnhanced = "true";
    const prefix = `jf-tabs-${++sequence}`;
    const tablist = document.createElement('div');
    tablist.className = 'jf-tablist'; tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', group.dataset.jfLabel || 'Tabbed content');
    tablist.setAttribute('aria-orientation', group.dataset.jfOrientation || 'horizontal');
    const buttons = panels.map((panel, i) => {
      const button = document.createElement('button'); button.type = 'button';
      button.id = `${prefix}-tab-${i}`; panel.id ||= `${prefix}-panel-${i}`;
      button.textContent = panel.dataset.jfTitle || `Tab ${i + 1}`;
      button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', panel.id);
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id); panel.tabIndex = 0;
      tablist.append(button); return button;
    });
    const select = (index: number) => {
      buttons.forEach((button, i) => { button.setAttribute('aria-selected', String(i === index)); button.tabIndex = i === index ? 0 : -1; panels[i]!.hidden = i !== index; });
    };
    const selected = Math.min(panels.length - 1, Math.max(0, (Number(group.dataset.jfSelected) || 1) - 1));
    select(selected); group.prepend(tablist);
    buttons.forEach((button, i) => {
      button.addEventListener('click', () => select(i));
      button.addEventListener('keydown', event => {
        const vertical = group.dataset.jfOrientation === 'vertical';
        const rtl = getComputedStyle(group).direction === 'rtl';
        const next = vertical ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
        const previous = vertical ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
        let index = i;
        if (event.key === next) index = (i + 1) % buttons.length;
        else if (event.key === previous) index = (i + buttons.length - 1) % buttons.length;
        else if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = buttons.length - 1;
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(i); return; }
        else return;
        event.preventDefault(); buttons[index]!.focus();
        if (group.dataset.jfActivation !== 'manual') select(index);
      });
    });
  }
  for (const toc of root.querySelectorAll<HTMLElement>('.jf-toc')) {
    if (toc.dataset.jfEnhanced) continue; toc.dataset.jfEnhanced = 'true';
    const scope = toc.closest('.site-main') || document.querySelector('.site-main') || document.body;
    const min = Math.max(1, Number(toc.dataset.jfMin) || 2), max = Math.min(6, Number(toc.dataset.jfMax) || 3);
    const headings = Array.from(scope.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).filter(heading => {
      const level = Number(heading.tagName.slice(1));
      return level >= min && level <= max && !heading.closest('.jf-toc,.jf-source-bank,.sv-source-bank') && Boolean(heading.textContent?.trim());
    });
    const list = document.createElement(toc.dataset.jfNumbered === 'true' ? 'ol' : 'ul');
    for (const heading of headings.slice(0, 200)) {
      if (!heading.id || document.getElementById(heading.id) !== heading) {
        let candidate: string;
        do { candidate = `jf-heading-${++sequence}`; } while (document.getElementById(candidate));
        heading.id = candidate;
      }
      const item = document.createElement('li'), link = document.createElement('a');
      item.style.marginInlineStart = `${Math.max(0, Number(heading.tagName.slice(1)) - min)}em`;
      link.href = `#${encodeURIComponent(heading.id)}`; link.textContent = heading.textContent;
      link.addEventListener('click', () => {
        heading.closest<HTMLElement>('.jf-tab')?.closest<HTMLElement>('.jf-tabs')?.querySelector<HTMLButtonElement>(`[aria-controls="${CSS.escape(heading.closest<HTMLElement>('.jf-tab')!.id)}"]`)?.click();
        for (let node = heading.parentElement; node; node = node.parentElement) if (node instanceof HTMLDetailsElement) node.open = true;
      });
      item.append(link); list.append(item);
    }
    toc.querySelector('[data-jf-toc-items]')?.replaceChildren(list);
    toc.hidden = !headings.length && toc.dataset.jfHideEmpty === 'true';
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-jf-dismiss]')) {
    if (button.dataset.jfEnhanced) continue; button.dataset.jfEnhanced = 'true';
    button.addEventListener('click', () => { const notice = button.closest<HTMLElement>('.jf-callout'); if (notice) notice.hidden = true; });
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-jf-cover-toggle]')) {
    if (button.dataset.jfEnhanced) continue; button.dataset.jfEnhanced = 'true';
    const media = button.closest('.jf-cover')?.querySelector('video');
    if (!media) continue;
    const sync = () => { button.textContent = media.paused ? '▶' : 'Ⅱ'; button.setAttribute('aria-label', media.paused ? button.dataset.jfPlayLabel || 'Play background video' : button.dataset.jfPauseLabel || 'Pause background video'); };
    media.addEventListener('pause', sync); media.addEventListener('play', sync);
    button.addEventListener('click', () => { if (media.paused) void media.play().catch(sync); else media.pause(); });
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) media.pause(); sync();
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => enhanceBlocks());
  else enhanceBlocks();
}
