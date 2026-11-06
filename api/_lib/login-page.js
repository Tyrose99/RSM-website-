// The login screen shown at /jarvis when nobody is logged in (served by /middleware.js)
export const loginPage = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Jarvis · Sign in</title>
<style>
  :root { --red: #e5383b; --bg: #050505; --ink: #f2eee8; --muted: #8a8587; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  body { display: grid; place-items: center; padding: 20px;
    background: radial-gradient(circle at 50% 42%, rgba(229, 56, 59, .22), transparent 55%), var(--bg); }
  form { width: min(360px, 100%); padding: 32px 28px; border-radius: 18px;
    background: rgba(255, 255, 255, .04); border: 1px solid rgba(229, 56, 59, .35);
    box-shadow: 0 0 60px -10px rgba(229, 56, 59, .35); backdrop-filter: blur(12px); }
  h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: .35em; text-align: center; }
  p { margin: 0 0 24px; text-align: center; color: var(--muted); font-size: 13px; letter-spacing: .08em; }
  label { display: block; font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: var(--muted); margin: 14px 0 6px; }
  select, input { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(242, 238, 232, .15);
    background: rgba(0, 0, 0, .5); color: var(--ink); font-size: 16px; }
  select:focus, input:focus { outline: 2px solid var(--red); outline-offset: 1px; }
  button { margin-top: 22px; width: 100%; padding: 13px; border: 0; border-radius: 999px; background: var(--red);
    color: #fff; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; font-size: 13px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: wait; }
  .err { min-height: 18px; margin-top: 14px; color: #ff8a8c; font-size: 13px; text-align: center; }
</style>
</head>
<body>
<form id="f" autocomplete="on">
  <h1>JARVIS</h1>
  <p>Private · RSM</p>
  <label for="u">Who's this?</label>
  <select id="u" name="username" autocomplete="username"><option value="justin">Justin</option><option value="tyler">Tyler</option></select>
  <label for="p">Password</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required>
  <button id="b" type="submit">Sign in</button>
  <div class="err" id="e" role="alert"></div>
</form>
<script>
  const f = document.getElementById("f"), b = document.getElementById("b"), e = document.getElementById("e");
  try { const last = localStorage.getItem("jarvis-user"); if (last) f.u.value = last; } catch (_) {}
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault(); b.disabled = true; e.textContent = "";
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: f.u.value, password: f.p.value }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { try { localStorage.setItem("jarvis-user", f.u.value); } catch (_) {} location.replace("/jarvis/"); return; }
      e.textContent = j.error || "Couldn't sign in.";
    } catch (_) { e.textContent = "Network error. Try again."; }
    b.disabled = false; f.p.select();
  });
</script>
</body>
</html>`;
