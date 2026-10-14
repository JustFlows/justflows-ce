// SPDX-License-Identifier: MIT
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBlock } from "../../../src/components/builder/block-defaults";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import TableEditor from "../../../src/components/builder/TableEditor";
import { enhanceBlocks } from "../../../../public-scripts/src/block-interactions";
import { createBlockRegistrySync } from "@justflows/blocks";
const registry = createBlockRegistrySync();
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
describe('functional block editing and behavior', () => {
  it('initializes containers and independent structured defaults', () => {
    expect(createBlock('core.list').children?.[0]?.type).toBe('core.list-item');
    expect(createBlock('core.accordion').children?.[0]?.type).toBe('core.details');
    expect(createBlock('core.tabs').children).toHaveLength(2);
    const first = createBlock('core.table'), second = createBlock('core.table');
    (first.props.rows as string[][])[0]![0] = 'changed';
    expect((second.props.rows as string[][])[0]![0]).toBe('');
    expect(createBlock('core.card').children).toEqual([]);
  });
  it('edits table cells and adds/removes rows without JSON', () => {
    const changed = vi.fn();
    render(<I18nProvider><TableEditor value={[['A', 'B'], ['C', 'D']]} onChange={changed} /></I18nProvider>);
    fireEvent.change(screen.getByLabelText('Row 2, column 1'), { target: { value: 'Updated' } });
    expect(changed).toHaveBeenLastCalledWith([['A', 'B'], ['Updated', 'D']]);
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    expect(changed).toHaveBeenLastCalledWith([['A', 'B'], ['C', 'D'], ['', '']]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove column 1' }));
    expect(changed).toHaveBeenLastCalledWith([['B'], ['D']]);
  });
  it('provides tab roles, unique ids and automatic keyboard navigation', () => {
    document.body.innerHTML = registry.renderNode({ type: 'core.tabs', props: { selected: 2 }, children: [{ type: 'core.tab', props: { title: 'One' } }, { type: 'core.tab', props: { title: 'Two' } }] });
    enhanceBlocks();
    const tabs = screen.getAllByRole('tab'); expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tabs[1]!, { key: 'Home' }); expect(tabs[0]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[0]!.id);
    enhanceBlocks(); expect(screen.getAllByRole('tab')).toHaveLength(2);
  });
  it('supports manual activation and keeps independent tab groups separate', () => {
    const node = { type: 'core.tabs', props: { activation: 'manual' }, children: [{ type: 'core.tab', props: { title: 'One' } }, { type: 'core.tab', props: { title: 'Two' } }] };
    document.body.innerHTML = registry.renderNode(node) + registry.renderNode(node); enhanceBlocks();
    const tabs = screen.getAllByRole('tab');
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' }); expect(tabs[1]).toHaveFocus(); expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tabs[1]!, { key: 'Enter' }); expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true'); expect(new Set(tabs.map(tab => tab.id)).size).toBe(4);
  });
  it('keeps exclusive accordions local and notices dismissible', () => {
    document.body.innerHTML = registry.renderNode({ type: 'core.accordion', props: {}, children: [{ type: 'core.details', props: { summary: 'First', open: true } }, { type: 'core.details', props: { summary: 'Second' } }] }) + registry.renderNode({ type: 'core.callout', props: { dismissible: true, title: 'Notice' } });
    enhanceBlocks(); const panels = document.querySelectorAll('details'); panels[1]!.open = true; fireEvent(panels[1]!, new Event('toggle'));
    expect(panels[0]!.open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' })); expect(document.querySelector<HTMLElement>('.jf-callout')!.hidden).toBe(true);
  });
  it('builds contents from headings without duplicate anchors or unsafe markup', () => {
    document.body.innerHTML = `<main class="site-main">${registry.renderNode({ type: 'core.table-of-contents', props: { minLevel: 2, maxLevel: 3 } })}<h2 id="existing">Intro</h2><h3>&lt;script&gt;</h3><h4>Excluded</h4></main>`;
    enhanceBlocks(); const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2); expect(links[0]).toHaveAttribute('href', '#existing');
    expect(links[1]).toHaveTextContent('<script>'); expect(document.querySelector('script')).toBeNull();
  });
});
