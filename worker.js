/**
 * The Spicedun Wine Store — API
 *
 * Keeps one record in Cloudflare KV holding the list of names and every
 * bottle logged. Four endpoints, all under /api.
 *
 *   GET    /api/state          read everything
 *   POST   /api/person         { name }                 add a name
 *   POST   /api/entry          { name, wine, price }    log a bottle
 *   DELETE /api/entry?id=xyz                            undo a bottle
 */

const KEY = "state";
const EMPTY = { people: [], log: [] };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Passcode",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

async function readState(env) {
  const raw = await env.STORE.get(KEY);
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw);
    return { people: parsed.people || [], log: parsed.log || [] };
  } catch {
    return { ...EMPTY };
  }
}

async function writeState(env, state) {
  await env.STORE.put(KEY, JSON.stringify(state));
  return state;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Optional shared passcode. Set PASSCODE as a Worker variable to turn it on.
    if (env.PASSCODE) {
      const supplied = request.headers.get("X-Passcode");
      if (supplied !== env.PASSCODE) {
        return json({ error: "Wrong passcode" }, 401);
      }
    }

    try {
      if (path === "/api/state" && request.method === "GET") {
        return json(await readState(env));
      }

      if (path === "/api/person" && request.method === "POST") {
        const { name } = await request.json();
        const clean = String(name || "").trim().slice(0, 24);
        if (!clean) return json({ error: "Name can't be empty" }, 400);

        const state = await readState(env);
        const taken = state.people.some(
          (p) => p.toLowerCase() === clean.toLowerCase()
        );
        if (taken) return json({ error: "That name's already on the slate" }, 409);

        state.people.push(clean);
        return json(await writeState(env, state));
      }

      if (path === "/api/entry" && request.method === "POST") {
        const { name, wine, price } = await request.json();
        if (!name || !wine || typeof price !== "number") {
          return json({ error: "Missing name, wine or price" }, 400);
        }

        const state = await readState(env);
        state.log.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          name: String(name).slice(0, 24),
          wine: String(wine).slice(0, 8),
          price,
          ts: Date.now(),
        });
        return json(await writeState(env, state));
      }

      if (path === "/api/entry" && request.method === "DELETE") {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "Missing entry id" }, 400);

        const state = await readState(env);
        state.log = state.log.filter((e) => e.id !== id);
        return json(await writeState(env, state));
      }

      return json({ error: "No such endpoint" }, 404);
    } catch (err) {
      return json({ error: "Something went wrong: " + err.message }, 500);
    }
  },
};
