// SPDX-License-Identifier: MIT
import { expectTypeOf, it } from "vitest";
import type { ActionEventMap, FilterValueMap, ActionPayload } from "../../src/index.js";

it("ships generic hook maps without commerce plugin contracts", () => {
  expectTypeOf<Extract<keyof ActionEventMap, `justflows.store.${string}`>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<keyof FilterValueMap, `justflows.store.${string}`>>().toEqualTypeOf<never>();
  expectTypeOf<ActionPayload<"justflows.store.order.paid">>().toEqualTypeOf<unknown>();
});
