import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";
import { preloadEnglishFallback } from "../../src/i18n/I18nProvider";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});

/** Components render English at once, as they do after the server's first render. */
beforeAll(async () => {
  await preloadEnglishFallback();
});
