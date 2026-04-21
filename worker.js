// ============================================================
// Miel Witer – Cloudflare Worker v2
// ============================================================
// Variables de entorno (Settings > Variables):
//   ADMIN_TOKEN        → contraseña maestra del worker
//   GITHUB_TOKEN       → Personal Access Token de GitHub
//   GITHUB_OWNER       → usuario de GitHub
//   GITHUB_REPO        → nombre del repo
//   GITHUB_FILE_PATH   → productos.json
//   GITHUB_CLIENTES_PATH → clientes.json
//   CLOUDINARY_CLOUD   → cloud name
//   CLOUDINARY_KEY     → API Key
//   CLOUDINARY_SECRET  → API Secret
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function unauthorized() { return json({ error: "Unauthorized" }, 401); }

function validateToken(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.ADMIN_TOKEN}`;
}

async function sha1(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

// ── Helper: leer archivo de GitHub ──────────────────────────
async function githubGet(env, filePath) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${filePath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      "User-Agent": "miel-witer-worker",
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) throw new Error("GitHub GET failed: " + res.status);
  const data = await res.json();
  const content = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, "")))));
  return { content, sha: data.sha };
}

// ── Helper: escribir archivo en GitHub ──────────────────────
async function githubPut(env, filePath, content, sha, mensaje) {
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${filePath}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      "User-Agent": "miel-witer-worker",
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: mensaje, content: encoded, sha }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "GitHub PUT failed: " + res.status);
  }
  return true;
}

// ── Helper: subir imagen a Cloudinary ───────────────────────
async function cloudinaryUpload(env, file, folder) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const strToSign = `folder=${folder}&timestamp=${timestamp}${env.CLOUDINARY_SECRET}`;
  const signature = await sha1(strToSign);
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", env.CLOUDINARY_KEY);
  form.append("timestamp", timestamp);
  form.append("folder", folder);
  form.append("signature", signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD}/image/upload`, {
    method: "POST", body: form,
  });
  if (!res.ok) throw new Error("Cloudinary upload failed");
  return await res.json();
}

// ── Helper: eliminar imagen de Cloudinary ───────────────────
async function cloudinaryDelete(env, public_id) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const strToSign = `public_id=${public_id}&timestamp=${timestamp}${env.CLOUDINARY_SECRET}`;
  const signature = await sha1(strToSign);
  const form = new FormData();
  form.append("public_id", public_id);
  form.append("api_key", env.CLOUDINARY_KEY);
  form.append("timestamp", timestamp);
  form.append("signature", signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD}/image/destroy`, {
    method: "POST", body: form,
  });
  if (!res.ok) throw new Error("Cloudinary delete failed");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;

    // ── GET /ping ──────────────────────────────────────────
    if (path === "/ping" && request.method === "GET") {
      if (!validateToken(request, env)) return unauthorized();
      return json({ ok: true, mensaje: "Worker Miel Witer v2 activo ✓" });
    }

    // ── GET /productos ─────────────────────────────────────
    if (path === "/productos" && request.method === "GET") {
      try {
        const { content, sha } = await githubGet(env, env.GITHUB_FILE_PATH);
        return json({ productos: content, sha });
      } catch(e) {
        return json({ error: e.message }, 500);
      }
    }

    // ── PUT /productos ─────────────────────────────────────
    if (path === "/productos" && request.method === "PUT") {
      if (!validateToken(request, env)) return unauthorized();
      try {
        const { productos } = await request.json();
        // Siempre re-leer el SHA actual antes de escribir para evitar conflictos
        const { sha: currentSha } = await githubGet(env, env.GITHUB_FILE_PATH);
        await githubPut(env, env.GITHUB_FILE_PATH, productos, currentSha, "Actualización de productos desde panel admin");
        const { sha: newSha } = await githubGet(env, env.GITHUB_FILE_PATH);
        return json({ ok: true, sha: newSha });
      } catch(e) {
        return json({ error: e.message }, 500);
      }
    }

    // ── GET /clientes ──────────────────────────────────────
    if (path === "/clientes" && request.method === "GET") {
      try {
        const filePath = env.GITHUB_CLIENTES_PATH || "clientes.json";
        const { content, sha } = await githubGet(env, filePath);
        return json({ clientes: content, sha });
      } catch(e) {
        return json({ error: e.message }, 500);
      }
    }

    // ── PUT /clientes ──────────────────────────────────────
    if (path === "/clientes" && request.method === "PUT") {
      if (!validateToken(request, env)) return unauthorized();
      try {
        const filePath = env.GITHUB_CLIENTES_PATH || "clientes.json";
        const { clientes } = await request.json();
        // Siempre re-leer el SHA actual antes de escribir para evitar conflictos
        const { sha: currentSha } = await githubGet(env, filePath);
        await githubPut(env, filePath, clientes, currentSha, "Actualización de clientes felices desde panel admin");
        const { sha: newSha } = await githubGet(env, filePath);
        return json({ ok: true, sha: newSha });
      } catch(e) {
        return json({ error: e.message }, 500);
      }
    }

    // ── POST /imagen ───────────────────────────────────────
    if (path === "/imagen" && request.method === "POST") {
      if (!validateToken(request, env)) return unauthorized();
      try {
        const formData = await request.formData();
        const file = formData.get("file");
        const folder = formData.get("folder") || "miel-witer/productos";
        if (!file) return json({ error: "No se recibió archivo" }, 400);
        const data = await cloudinaryUpload(env, file, folder);
        return json({ url: data.secure_url, public_id: data.public_id });
      } catch(e) {
        return json({ error: e.message }, 500);
      }
    }

    // ── DELETE /imagen ─────────────────────────────────────
    if (path === "/imagen" && request.method === "DELETE") {
      if (!validateToken(request, env)) return unauthorized();
      try {
        const { public_id } = await request.json();
        if (!public_id) return json({ error: "Falta public_id" }, 400);
        await cloudinaryDelete(env, public_id);
        return json({ ok: true });
      } catch(e) {
        return json({ error: e.message }, 500);
      }
    }

    // ── POST /cambiar-password ─────────────────────────────
    if (path === "/cambiar-password" && request.method === "POST") {
      if (!validateToken(request, env)) return unauthorized();
      return json({
        ok: true,
        mensaje: "Token válido. Para cambiar ADMIN_TOKEN, actualizalo en Cloudflare Workers Dashboard.",
        link: "https://dash.cloudflare.com",
      });
    }

    return json({ error: "Ruta no encontrada" }, 404);
  },
};
