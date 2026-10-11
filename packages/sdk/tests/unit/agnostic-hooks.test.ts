// SPDX-License-Identifier: MIT
import { expectTypeOf, it } from "vitest";
import type { ActionEventMap, FilterValueMap, ActionPayload } from "../../src/index.js";

it("ships generic hook maps without commerce plugin contracts", () => {
  expectTypeOf<Extract<keyof ActionEventMap, `justflows.shop.${string}`>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<keyof FilterValueMap, `justflows.shop.${string}`>>().toEqualTypeOf<never>();
  expectTypeOf<ActionPayload<"justflows.shop.order.paid">>().toEqualTypeOf<unknown>();
});
