import { createInterface } from "node:readline/promises";
import { apiPost } from "../api.js";

export async function userCommand(args: string[]): Promise<void> {
  const [sub] = args;
  if (sub !== "create") { console.log("Usage: justflows user create"); return; }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("\nCreate a new Justflows user\n");
    const email = await rl.question("Email: ");
    const username = await rl.question("Username: ");
    const displayName = await rl.question("Display name: ");
    const password = await rl.question("Password (min 8 chars): ");
    const role = await rl.question("Role [administrator/editor/author/contributor/subscriber] (default: subscriber): ");

    await apiPost("/api/users", {
      email,
      username,
      displayName,
      password,
      role: role.trim() || "subscriber",
    });

    console.log(`\n✓ User created: ${email}`);
  } finally {
    rl.close();
  }
}
