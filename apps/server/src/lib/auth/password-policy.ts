// SPDX-License-Identifier: MIT

import { z } from "zod";

/**
 * One password rule for the whole product.
 *
 * NIST SP 800-63B: length is worth more than composition, 8 is the floor and
 * 12+ the recommendation, and an upper bound only exists so a multi-megabyte
 * input cannot turn 600,000 PBKDF2 iterations into a denial of service.
 *
 * Registration and the install wizard already required 12; POST /api/users
 * required 8, so an administrator creating an account could set a weaker
 * password than the same person could choose for themselves.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

export const PasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, "Password is too long");
