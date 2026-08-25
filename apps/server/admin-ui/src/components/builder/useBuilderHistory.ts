import { useCallback, useEffect, useRef, useState } from "react";

const LIMIT = 60;
/** Edits closer together than this are one step, so typing does not fill history. */
const COALESCE_MS = 500;

export interface HistoryState<T> {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Call after every change that came from the editor, not from history. */
  record: (value: T) => void;
}

/**
 * Undo/redo over a value the parent owns.
 *
 * History cannot live inside the state it tracks, because the same value also
 * flows in from the server on load and back out on save. So it observes: the
 * parent keeps calling `record` with what it just committed, and the hook only
 * takes over during an undo or redo, which it marks so its own write is not
 * recorded as a new step.
 */
export function useBuilderHistory<T>(current: T, apply: (value: T) => void): HistoryState<T> {
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const lastAt = useRef(0);
  const travelling = useRef(false);
  const baseline = useRef<T>(current);
  const [, force] = useState(0);

  const rerender = useCallback(() => force((n) => n + 1), []);

  const record = useCallback((value: T) => {
    if (travelling.current) {
      travelling.current = false;
      baseline.current = value;
      return;
    }
    const now = Date.now();
    // Successive keystrokes collapse into the step they started from.
    if (now - lastAt.current > COALESCE_MS) {
      past.current = [...past.current, baseline.current].slice(-LIMIT);
      future.current = [];
    }
    lastAt.current = now;
    baseline.current = value;
    rerender();
  }, [rerender]);

  const undo = useCallback(() => {
    const previous = past.current.at(-1);
    if (previous === undefined) return;
    past.current = past.current.slice(0, -1);
    future.current = [baseline.current, ...future.current].slice(0, LIMIT);
    travelling.current = true;
    lastAt.current = 0;
    apply(previous);
    rerender();
  }, [apply, rerender]);

  const redo = useCallback(() => {
    const next = future.current[0];
    if (next === undefined) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, baseline.current].slice(-LIMIT);
    travelling.current = true;
    lastAt.current = 0;
    apply(next);
    rerender();
  }, [apply, rerender]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      // A text field has its own undo stack and should keep it. The target is
      // not always an element — a key pressed with nothing focused arrives on
      // the document itself, which has no closest().
      const target = e.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return {
    undo,
    redo,
    record,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
