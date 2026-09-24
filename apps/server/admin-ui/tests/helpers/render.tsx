import { render as testingLibraryRender, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nProvider } from "../../src/i18n/I18nProvider";

/** Match the application root for components that use translated labels. */
export function render(ui: ReactElement, options?: RenderOptions) {
  return testingLibraryRender(<I18nProvider>{ui}</I18nProvider>, options);
}
