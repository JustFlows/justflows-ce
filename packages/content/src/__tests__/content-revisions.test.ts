// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { HooksRegistry } from "@justflows/core";
import { ContentService, ConflictError } from "../service/content-service.js";
import { diffSnapshots, selectHistoricalIdsToPrune } from "../service/revisions.js";

function setup() {
  const hooks = new HooksRegistry({ failureThreshold: 0 });
  return { hooks, content: new ContentService(hooks) };
}

const EMPTY = { version: 1 as const, blocks: [] };

describe("working revisions", () => {
  it("keeps unpublished edits on the content row without a working revision", async () => {
    const { content } = setup();
    const item = await content.create({ siteId: "site-1", title: "Hello" });
    const saved = await content.update(item.id, { title: "Hello again" });
    expect(saved.status).toBe("draft");
    expect(saved.title).toBe("Hello again");
    expect(saved.hasWorkingRevision).toBeFalsy();
    expect(await content.getWorkingRevision(item.id)).toBeUndefined();
    expect((await content.get(item.id))?.title).toBe("Hello again");
  });

  it("does not change the live snapshot when saving a published item", async () => {
    const { content } = setup();
    const item = await content.create({ siteId: "site-1", title: "Live", slug: "live" });
    await content.publish(item.id);
    const saved = await content.update(item.id, { title: "Draft title" });

    expect(saved.title).toBe("Draft title");
    expect(saved.hasWorkingRevision).toBe(true);
    expect(saved.live?.title).toBe("Live");
    expect(saved.status).toBe("published");

    const raw = (await content.find({ siteId: "site-1", slug: "live" })).items[0];
    expect(raw?.title).toBe("Live");
    expect(raw?.hasWorkingRevision).toBe(true);
  });

  it("repeated draft saves update the same working revision", async () => {
    const { content } = setup();
    const item = await content.create({ siteId: "site-1", title: "Live" });
    await content.publish(item.id);
    await content.update(item.id, { title: "One" });
    const second = await content.update(item.id, { title: "Two" });
    const working = await content.getWorkingRevision(item.id);
    expect(working?.id).toBe(second.workingRevisionId);
    expect(working?.title).toBe("Two");
    const pending = (await content.getRevisions(item.id)).filter((r) => r.kind === "working");
    expect(pending).toHaveLength(1);
  });

  it("publishes the working revision onto live and removes the pending revision", async () => {
    const { content } = setup();
    const item = await content.create({ siteId: "site-1", title: "Live", slug: "live" });
    const published = await content.publish(item.id);
    await content.update(item.id, { title: "Next", slug: "next" });
    const liveAgain = await content.publish(item.id, { expectedVersion: published.version });

    expect(liveAgain.title).toBe("Next");
    expect(liveAgain.slug).toBe("next");
    expect(liveAgain.status).toBe("published");
    expect(liveAgain.hasWorkingRevision).toBeFalsy();
    expect(await content.getWorkingRevision(item.id)).toBeUndefined();
    const history = (await content.getRevisions(item.id)).filter((r) => r.kind === "historical");
    expect(history[0]?.title).toBe("Live");
  });

  it("keeps the working revision when beforePublish cancels", async () => {
    const { hooks, content } = setup();
    const item = await content.create({ siteId: "site-1", title: "Live" });
    await content.publish(item.id);
    await content.update(item.id, { title: "Draft" });
    hooks.gate("content.beforePublish", (event: { cancel: (reason: string) => void }) => {
      event.cancel("Awaiting review");
    });
    await expect(content.publish(item.id)).rejects.toMatchObject({ reason: "Awaiting review" });
    expect((await content.get(item.id))?.title).toBe("Draft");
    expect((await content.getWorkingRevision(item.id))?.title).toBe("Draft");
    const listed = (await content.find({ siteId: "site-1" })).items[0];
    expect(listed?.title).toBe("Live");
  });

  it("does not fire content.updated when only the working revision is saved", async () => {
    const { hooks, content } = setup();
    const updated = { count: 0 };
    hooks.action("content.updated", () => {
      updated.count += 1;
    });
    const item = await content.create({ siteId: "site-1", title: "Live" });
    await content.publish(item.id);
    expect(updated.count).toBe(1);
    await content.update(item.id, { title: "Draft" });
    expect(updated.count).toBe(1);
    await content.publish(item.id);
    expect(updated.count).toBe(2);
  });

  it("discards the working revision and restores the editor to live content", async () => {
    const { content } = setup();
    const item = await content.create({ siteId: "site-1", title: "Live" });
    await content.publish(item.id);
    await content.update(item.id, { title: "Draft" });
    const discarded = await content.discardWorking(item.id);
    expect(discarded.title).toBe("Live");
    expect(discarded.hasWorkingRevision).toBeFalsy();
  });

  it("restores a historical snapshot into a working draft without changing live", async () => {
    const { content } = setup();
    const item = await content.create({ siteId: "site-1", title: "V1" });
    await content.publish(item.id);
    await content.update(item.id, { title: "V2" });
    await content.publish(item.id);
    const history = (await content.getRevisions(item.id)).filter((r) => r.kind === "historical");
    const restored = await content.restoreRevision(item.id, history[0]!.id);
    expect(restored.title).toBe("V1");
    expect(restored.hasWorkingRevision).toBe(true);
    const listed = (await content.find({ siteId: "site-1" })).items[0];
    expect(listed?.title).toBe("V2");
  });

  it("compares working revision fields against the live snapshot", async () => {
    const { content } = setup();
    const item = await content.create({
      siteId: "site-1",
      title: "Live",
      excerpt: "old",
      blocks: EMPTY,
    });
    await content.publish(item.id);
    await content.update(item.id, { title: "Draft", excerpt: "new" });
    const diff = await content.compare(item.id);
    expect(diff.changed).toBe(true);
    expect(diff.entries.map((e) => e.field)).toEqual(["title", "excerpt"]);
  });

  it("rejects a publish when the live version moved under the working draft", async () => {
    const { content } = setup();
    const item = await content.create({ siteId: "site-1", title: "Live" });
    const published = await content.publish(item.id);
    await content.update(item.id, { title: "Draft" });
    await expect(
      content.publish(item.id, { expectedVersion: published.version - 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await content.getWorkingRevision(item.id))?.title).toBe("Draft");
  });

  it("never prunes the working revision when history is trimmed", async () => {
    const { content } = setup();
    content.setMaxHistory(2);
    const item = await content.create({ siteId: "site-1", title: "V1" });
    await content.publish(item.id);
    for (const title of ["V2", "V3", "V4"]) {
      await content.update(item.id, { title });
      await content.publish(item.id);
    }
    await content.update(item.id, { title: "Working" });
    const revs = await content.getRevisions(item.id);
    expect(revs.filter((r) => r.kind === "working")).toHaveLength(1);
    expect(revs.filter((r) => r.kind === "historical").length).toBeLessThanOrEqual(2);
  });
});

describe("revision helpers", () => {
  it("diffs snapshots field by field", () => {
    const diff = diffSnapshots(
      { title: "A", slug: "a", excerpt: null, blocks: EMPTY, fields: { seoTitle: "A" } },
      { title: "B", slug: "a", excerpt: null, blocks: EMPTY, fields: { seoTitle: "B" } },
    );
    expect(diff.entries.map((e) => e.field)).toEqual(["title", "fields"]);
  });

  it("keeps the newest historical rows when pruning", () => {
    const ids = selectHistoricalIdsToPrune(
      [
        { id: "old", createdAt: "2020-01-01T00:00:00.000Z" },
        { id: "new", createdAt: "2024-01-01T00:00:00.000Z" },
        { id: "mid", createdAt: "2022-01-01T00:00:00.000Z" },
      ],
      2,
    );
    expect(ids).toEqual(["old"]);
  });
});
