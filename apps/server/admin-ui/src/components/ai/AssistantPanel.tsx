import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useT } from "../../i18n/I18nProvider";
import { Link } from "../../admin-router";
import { useCapability } from "../SessionProvider";
import {
  aiJson,
  AiRequestError,
  streamAssistant,
  type AssistantEvent,
  type AssistantStatus,
  type ChatMessage,
  type ModelChoice,
  type PreviewChange,
  type ToolCall,
} from "../../lib/ai-api";

/**
 * The in-admin assistant (#159). The conversation lives only in this browser
 * tab (sessionStorage); the server keeps no history. Read-only tools run on
 * the server automatically; every change arrives here as a confirmation card
 * and runs only when the user approves it.
 */

interface PendingConfirm {
  call: ToolCall;
  title: string;
  destructive: boolean;
  preview: { summary: string; changes: PreviewChange[] };
  decision?: "approved" | "declined" | "running";
}

const HISTORY_KEY = "jf.assistant.history";
const CHOICE_KEY = "jf.assistant.model";

function readSession<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeSession(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the conversation still works for this view.
  }
}

function readChoice(): ModelChoice | null {
  try {
    const raw = window.localStorage.getItem(CHOICE_KEY);
    return raw ? (JSON.parse(raw) as ModelChoice) : null;
  } catch {
    return null;
  }
}

export default function AssistantPanel({ context, onClose }: { context?: string; onClose: () => void }) {
  const { t } = useT();
  const canConfigure = useCapability("settings:manage");
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [choice, setChoice] = useState<ModelChoice | null>(readChoice);
  const [messages, setMessages] = useState<ChatMessage[]>(() => readSession(HISTORY_KEY, []));
  const [streaming, setStreaming] = useState("");
  const [activity, setActivity] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingConfirm[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tokens, setTokens] = useState({ input: 0, output: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    aiJson<AssistantStatus>("/api/ai/assistant/status", undefined, t("common.requestFailed"))
      .then((next) => {
        setStatus(next);
        setChoice((current) => {
          const valid = current && next.providers.some((p) => p.provider === current.provider && p.source === current.source);
          if (valid) return current;
          const first = next.providers[0];
          return first ? { source: first.source, provider: first.provider, model: first.defaultModel ?? first.models[0] ?? "" } : null;
        });
      })
      .catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeSession(HISTORY_KEY, messages);
  }, [messages]);
  useEffect(() => {
    if (!choice) return;
    try {
      window.localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
    } catch {
      // Remembering the model is a convenience only.
    }
  }, [choice]);
  // Braces, not an expression body: Chrome's scrollIntoView() now returns a
  // Promise, and React would call that returned value as the cleanup.
  useEffect(() => {
    void endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming, pending, activity]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const providerOptions = status?.providers ?? [];
  const currentProvider = providerOptions.find((p) => choice && p.provider === choice.provider && p.source === choice.source);
  const modelOptions = useMemo(() => {
    const list = [...(currentProvider?.models ?? [])];
    if (currentProvider?.defaultModel && !list.includes(currentProvider.defaultModel)) list.unshift(currentProvider.defaultModel);
    return list;
  }, [currentProvider]);

  async function runTurn(history: ChatMessage[]) {
    if (!choice?.model) {
      setError(t("ai.assistant.chooseModel"));
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError("");
    setStreaming("");
    setActivity([]);
    let working = history;
    const confirms: PendingConfirm[] = [];
    try {
      for await (const event of streamAssistant({ ...choice, messages: history, context }, controller.signal, t("common.requestFailed"))) {
        handle(event);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof AiRequestError || err instanceof Error ? err.message : t("common.requestFailed"));
      }
    } finally {
      setStreaming("");
      setBusy(false);
      abortRef.current = null;
      setMessages(working);
      if (confirms.length) setPending(confirms);
    }

    function handle(event: AssistantEvent) {
      switch (event.type) {
        case "text":
          setStreaming((current) => current + event.delta);
          break;
        case "message":
          working = [...working, event.message];
          setMessages(working);
          if (event.message.role === "assistant") setStreaming("");
          break;
        case "tool_status":
          setActivity((current) => [...current, `${event.ok ? "✓" : "✗"} ${event.title}`]);
          break;
        case "confirm":
          confirms.push({ call: event.call, title: event.title, destructive: event.destructive, preview: event.preview });
          break;
        case "usage":
          setTokens((current) => ({ input: current.input + event.inputTokens, output: current.output + event.outputTokens }));
          break;
        case "error":
          setError(event.error);
          break;
        default:
          break;
      }
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy || pending.length > 0) return;
    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    await runTurn(next);
  }

  function stop() {
    abortRef.current?.abort();
  }

  // One decision at a time, so each runs against the latest history.
  const deciding = pending.some((p) => p.decision === "running");

  async function decide(index: number, approve: boolean) {
    const item = pending[index];
    if (!item || item.decision || deciding) return;
    setPending((current) => current.map((p, i) => (i === index ? { ...p, decision: approve ? "running" : "declined" } : p)));
    let toolMessage: ChatMessage;
    try {
      const result = await aiJson<{ message: ChatMessage }>(
        "/api/ai/assistant/execute",
        { method: "POST", body: JSON.stringify({ call: item.call, approve }) },
        t("common.requestFailed"),
      );
      toolMessage = result.message;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
      setPending((current) => current.map((p, i) => (i === index ? { ...p, decision: undefined } : p)));
      return;
    }
    const nextPending = pending.map((p, i) => (i === index ? { ...p, decision: approve ? ("approved" as const) : ("declined" as const) } : p));
    setPending(nextPending);
    const nextMessages = [...messages, toolMessage];
    setMessages(nextMessages);
    // Once every proposed change has an answer, let the model continue.
    if (nextPending.every((p) => p.decision === "approved" || p.decision === "declined")) {
      setPending([]);
      await runTurn(nextMessages);
    }
  }

  function reset() {
    abortRef.current?.abort();
    setMessages([]);
    setPending([]);
    setTokens({ input: 0, output: 0 });
    setError("");
  }

  const visible = messages.filter(
    (m): m is Extract<ChatMessage, { role: "user" | "assistant" }> => m.role !== "tool" && (m.role === "user" || Boolean(m.content)),
  );

  return (
    <aside className="jf-assistant" role="dialog" aria-label={t("ai.assistant.title")}>
      <header className="jf-assistant__head">
        <h2 className="jf-card__title">{t("ai.assistant.title")}</h2>
        <div className="jf-row">
          <button className="jf-btn jf-btn--quiet jf-btn--sm" type="button" onClick={reset} disabled={busy}>
            {t("ai.assistant.newChat")}
          </button>
          <button className="jf-btn jf-btn--quiet jf-btn--sm" type="button" onClick={onClose} aria-label={t("common.close")}>
            ×
          </button>
        </div>
      </header>

      {status && !status.enabled ? (
        <p className="jf-assistant__empty">{t("ai.assistant.disabled")}</p>
      ) : status && providerOptions.length === 0 ? (
        <p className="jf-assistant__empty">
          {t("ai.assistant.noProvider")}{" "}
          {canConfigure ? <Link to="/admin/settings/ai">{t("ai.assistant.addKey")}</Link> : t("ai.assistant.askAdmin")}
        </p>
      ) : (
        <>
          <div className="jf-assistant__model">
            <select
              className="jf-input"
              aria-label={t("ai.assistant.provider")}
              value={choice ? `${choice.source}:${choice.provider}` : ""}
              onChange={(e) => {
                const [source, provider] = e.target.value.split(":") as [ModelChoice["source"], ModelChoice["provider"]];
                const entry = providerOptions.find((p) => p.source === source && p.provider === provider);
                setChoice({ source, provider, model: entry?.defaultModel ?? entry?.models[0] ?? "" });
              }}
            >
              {providerOptions.map((p) => (
                <option key={`${p.source}:${p.provider}`} value={`${p.source}:${p.provider}`}>
                  {(p.label || p.provider) + (p.source === "personal" ? ` · ${t("ai.assistant.personal")}` : "")}
                </option>
              ))}
            </select>
            {modelOptions.length > 0 ? (
              <select
                className="jf-input"
                aria-label={t("ai.assistant.model")}
                value={choice?.model ?? ""}
                onChange={(e) => choice && setChoice({ ...choice, model: e.target.value })}
              >
                {modelOptions.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="jf-input"
                aria-label={t("ai.assistant.model")}
                placeholder={t("ai.providers.modelPlaceholder")}
                value={choice?.model ?? ""}
                onChange={(e) => choice && setChoice({ ...choice, model: e.target.value })}
              />
            )}
          </div>

          <div className="jf-assistant__log" aria-live="polite">
            {visible.length === 0 && !streaming && <p className="jf-assistant__empty">{t("ai.assistant.intro")}</p>}
            {visible.map((message, index) => (
              <div key={index} className={`jf-assistant__msg jf-assistant__msg--${message.role}`}>
                {typeof message.content === "string"
                  ? message.content
                  : message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n")}
              </div>
            ))}
            {activity.length > 0 && (
              <ul className="jf-assistant__activity">
                {activity.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            )}
            {streaming && <div className="jf-assistant__msg jf-assistant__msg--assistant">{streaming}</div>}

            {pending.map((item, index) => (
              <div key={item.call.id} className={`jf-assistant__confirm${item.destructive ? " jf-assistant__confirm--danger" : ""}`}>
                <strong>{item.preview.summary}</strong>
                {item.preview.changes.length > 0 && (
                  <dl className="jf-assistant__diff">
                    {item.preview.changes.map((change) => (
                      <div key={change.field}>
                        <dt>{change.field}</dt>
                        {change.before !== null && <dd className="jf-assistant__before">{change.before || "—"}</dd>}
                        <dd className="jf-assistant__after">{change.after || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {item.decision === "approved" ? (
                  <p className="jf-status jf-status--saved">{t("ai.assistant.approved")}</p>
                ) : item.decision === "declined" ? (
                  <p className="jf-status">{t("ai.assistant.declined")}</p>
                ) : (
                  <div className="jf-row">
                    <button
                      type="button"
                      className={`jf-btn jf-btn--sm ${item.destructive ? "jf-btn--danger" : "jf-btn--primary"}`}
                      disabled={deciding}
                      onClick={() => void decide(index, true)}
                    >
                      {item.decision === "running" ? t("common.saving") : item.destructive ? t("ai.assistant.approveDestructive") : t("ai.assistant.approve")}
                    </button>
                    <button type="button" className="jf-btn jf-btn--sm" disabled={deciding} onClick={() => void decide(index, false)}>
                      {t("ai.assistant.decline")}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {error && (
              <div className="jf-alert jf-alert--error" role="alert">
                {error}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form className="jf-assistant__compose" onSubmit={send}>
            <textarea
              className="jf-input"
              rows={3}
              value={input}
              placeholder={pending.length ? t("ai.assistant.answerFirst") : t("ai.assistant.placeholder")}
              aria-label={t("ai.assistant.placeholder")}
              disabled={pending.length > 0}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="jf-assistant__footer">
              <span className="jf-field__hint">
                {t("ai.assistant.tokens", { input: tokens.input, output: tokens.output })}
                {status?.usage?.limit ? ` · ${t("ai.assistant.dailyUsage", { used: status.usage.requests, limit: status.usage.limit })}` : ""}
              </span>
              {busy ? (
                <button className="jf-btn jf-btn--sm" type="button" onClick={stop}>
                  {t("ai.assistant.stop")}
                </button>
              ) : (
                <button className="jf-btn jf-btn--primary jf-btn--sm" type="submit" disabled={!input.trim() || pending.length > 0}>
                  {t("ai.assistant.send")}
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </aside>
  );
}
