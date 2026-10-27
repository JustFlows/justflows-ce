// SPDX-License-Identifier: MIT
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../../../src/i18n/I18nProvider", () => ({
  useT: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars?.label ? `${key} ${vars.label}` : key,
  }),
}));
let role = "administrator";
vi.mock("../../../../src/components/SessionProvider", () => ({ useSessionRole: () => role }));
vi.mock("../../../../src/ssr-data", () => ({ initialJson: () => null }));
import ContentTypesPage from "../../../../src/pages/admin/content/ContentTypesPage";

const product = {
  slug: "product",
  label: "Products",
  description: "Catalog",
  builtin: false,
  cacheControl: null,
  cacheControlEditable: true,
  fields: [
    { key: "price", label: "Price", type: "number", required: true },
    { key: "size", label: "Size", type: "select", required: false, options: ["Small", "Large"] },
  ],
};
function setup(fail = false) {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => ({
    ok: !(fail && init?.method === "PATCH"),
    json: async () =>
      init?.method === "PATCH"
        ? fail
          ? { error: "Save rejected" }
          : { type: { ...product, ...JSON.parse(String(init.body)) } }
        : { types: [product] },
  }));
  vi.stubGlobal("fetch", fetcher);
  render(<ContentTypesPage />);
  return fetcher;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  role = "administrator";
});

it("saves settings and field order together, preserving select options", async () => {
  const fetcher = setup();
  fireEvent.click(await screen.findByText("contentTypes.editFields"));
  expect(screen.getByText("contentTypes.systemFields")).toBeInTheDocument();
  expect(screen.getByText("contentTypes.saveChanges")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("contentTypes.labelLabel"), {
    target: { value: "Shop products" },
  });
  fireEvent.click(screen.getByLabelText("contentTypes.moveUp Size"));
  fireEvent.click(screen.getByText("contentTypes.saveChanges"));
  await screen.findByRole("status");
  const patch = fetcher.mock.calls.find((call) => call[1]?.method === "PATCH")?.[1];
  expect(JSON.parse(String(patch?.body))).toMatchObject({
    label: "Shop products",
    fields: [product.fields[1], product.fields[0]],
  });
  fireEvent.click(screen.getByText("← contentTypes.heading"));
  expect(screen.getByText("Shop products", { selector: "strong" })).toBeInTheDocument();
});

it("keeps a failed save editable and confirms discarding a draft", async () => {
  setup(true);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(await screen.findByText("contentTypes.editFields"));
  fireEvent.change(screen.getByLabelText("contentTypes.labelLabel"), {
    target: { value: "Unsaved" },
  });
  fireEvent.click(screen.getByText("contentTypes.saveChanges"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save rejected");
  fireEvent.click(screen.getByText("← contentTypes.heading"));
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByLabelText("contentTypes.labelLabel")).toHaveValue("Unsaved");
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByText("← contentTypes.heading"));
  expect(screen.getByText("Products", { selector: "strong" })).toBeInTheDocument();
});

it("allows authors to inspect settings and fields without mutation controls", async () => {
  role = "author";
  setup();
  fireEvent.click(await screen.findByText("contentTypes.editFields"));
  expect(screen.getByLabelText("contentTypes.labelLabel")).toBeDisabled();
  expect(screen.queryByText("contentTypes.addField")).toBeNull();
  expect(screen.queryByText("contentTypes.saveChanges")).toBeNull();
  fireEvent.click(screen.getAllByText("contentTypes.editFields")[0]!);
  expect(screen.getByLabelText("contentTypes.fieldKeyAria")).toBeDisabled();
});

it("edits select options and removes fields only after confirmation", async () => {
  setup();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(await screen.findByText("contentTypes.editFields"));
  fireEvent.click(screen.getAllByText("contentTypes.editFields")[1]!);
  fireEvent.change(screen.getByLabelText("contentTypes.selectOptionsAria"), {
    target: { value: "Small,Medium,Large" },
  });
  expect(screen.getByLabelText("contentTypes.selectOptionsAria")).toHaveValue("Small,Medium,Large");
  fireEvent.click(screen.getByLabelText("contentTypes.removeFieldAria Price"));
  expect(screen.queryByText("Price", { selector: "strong" })).toBeNull();
  expect(screen.getByText("Size", { selector: "strong" })).toBeInTheDocument();
});

it("persists per-type label and behavior settings together", async () => {
  const fetcher = setup();
  fireEvent.click(await screen.findByText("contentTypes.editFields"));
  fireEvent.change(screen.getByLabelText("contentTypes.pluralLabel"), {
    target: { value: "Shop products" },
  });
  fireEvent.change(screen.getByLabelText("contentTypes.editorLabel"), {
    target: { value: "blocks" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /contentTypes.settingsLabels.preview/ }));
  fireEvent.change(screen.getByLabelText("contentTypes.settingsLabels.comments"), {
    target: { value: "disabled" },
  });
  fireEvent.click(screen.getByText("contentTypes.saveChanges"));
  await screen.findByRole("status");
  const patch = fetcher.mock.calls.find((call) => call[1]?.method === "PATCH")?.[1];
  expect(JSON.parse(String(patch?.body)).settings).toMatchObject({
    pluralLabel: "Shop products",
    editor: "blocks",
    preview: false,
    comments: "disabled",
  });
});
