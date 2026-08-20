import { pbkdf2, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);
const ITERATIONS = 310_000;
const KEY_LEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await pbkdf2Async(password, salt, ITERATIONS, KEY_LEN, "sha256");
  return `$pbkdf2$${ITERATIONS}$${salt}$${key.toString("hex")}`;
}
