import { Component, type ReactNode } from "react";
import { useT } from "../../i18n/I18nProvider";

/**
 * Contains a rendering failure in an AI surface (assistant panel, provider
 * keys, connected apps, editor actions) so it shows an inline error instead
 * of unmounting the whole admin. The message is shown so it can be reported.
 */

function Fallback({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useT();
  return (
    <div className="jf-alert jf-alert--error" role="alert">
      <span>{t("ai.errors.crashed")}</span> <code>{message}</code>{" "}
      <button type="button" className="jf-btn jf-btn--sm" onClick={onRetry}>
        {t("ai.errors.retry")}
      </button>
    </div>
  );
}

export default class AiErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown) {
    console.error("[justflows] AI component crashed", error);
  }

  render() {
    if (this.state.error) {
      return <Fallback message={this.state.error.message} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
