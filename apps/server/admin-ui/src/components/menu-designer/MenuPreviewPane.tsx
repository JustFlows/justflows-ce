import { useCallback, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { useT } from "../../i18n/I18nProvider";

export type PreviewDevice = "desktop" | "tablet" | "mobile";

export interface MenuPreviewHandle {
  reload: () => void;
}

/** Live preview iframe, same mechanics as ThemeCustomizePage's — a real render of `/?preview=1`,
 * reloaded on every draft save, so the preview can never drift from what actually publishes.
 * The desktop/tablet/mobile toggle only constrains the iframe's rendered width. */
const MenuPreviewPane = forwardRef<MenuPreviewHandle>(function MenuPreviewPane(_props, ref) {
  const { t } = useT();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [device, setDevice] = useState<PreviewDevice>("desktop");

  const reload = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.src = `/?preview=1&_=${Date.now()}`;
  }, []);

  useImperativeHandle(ref, () => ({ reload }), [reload]);

  return (
    <div className="jf-card">
      <div className="jf-card__head">
        <h2 className="jf-card__title">{t("menus.preview.title")}</h2>
        <div className="jf-filterbar">
          {(["desktop", "tablet", "mobile"] as const).map((d) => (
            <button
              key={d}
              type="button"
              className="jf-chip"
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
            >
              {t(`menus.preview.${d}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="jf-card__body">
        <div className={`jf-menu-preview jf-menu-preview--${device}`}>
          <iframe ref={iframeRef} src="/?preview=1" title={t("menus.preview.title")} />
        </div>
      </div>
    </div>
  );
});

export default MenuPreviewPane;
