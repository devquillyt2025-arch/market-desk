// Preloaded (`node --import`) into every test file by `npm test`.
import { register } from "node:module";

// The pure maths imports reach the Supabase client at load time, which throws without these.
// Nothing connects: the tests never touch the network.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

register("./test-alias-hooks.mjs", import.meta.url);
