import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useCapability, useFeatureEnabled } from "../SessionProvider";
import AiErrorBoundary from "./AiErrorBoundary";
import AssistantPanel from "./AssistantPanel";

/**
 * Opens the assistant panel from anywhere in the admin shell: the sidebar
 * button, or the content editor with a short description of what is open.
 */
interface AssistantContextValue {
  available: boolean;
  open: (context?: string) => void;
  close: () => void;
}

const AssistantContext = createContext<AssistantContextValue>({ available: false, open: () => {}, close: () => {} });

export function AssistantProvider({ children }: { children: ReactNode }) {
  const available = useCapability("ai:use") && useFeatureEnabled("feature" + ".ai");
  const [isOpen, setOpen] = useState(false);
  const [context, setContext] = useState<string | undefined>();

  const open = useCallback((next?: string) => {
    setContext(next);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ available, open, close }), [available, open, close]);

  return (
    <AssistantContext.Provider value={value}>
      {children}
      {available && isOpen && (
        <AiErrorBoundary>
          <AssistantPanel context={context} onClose={close} />
        </AiErrorBoundary>
      )}
    </AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantContextValue {
  return useContext(AssistantContext);
}
