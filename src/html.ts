import type { Env } from "./env";
import { ANONYMOUS, type PublicReign, type Reign } from "./db";
import { MESSAGE_MAX, NAME_MAX } from "./validate";

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** JSON that is safe to drop inside a <script> tag. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const STYLES = `
:root{
  --bg:#1a0b2e; --bg2:#2d1452; --card:#24103f; --ink:#fff7e6; --muted:#c9b8e8;
  --gold:#ffcc00; --gold-dark:#c99a00; --pink:#ff3d8b; --teal:#22e0c6; --line:#ffffff1f;
}
*{box-sizing:border-box}
html,body{margin:0}
body{
  background:var(--bg); color:var(--ink);
  background-image:radial-gradient(circle at 20% -10%,#5b21b6 0,transparent 45%),radial-gradient(circle at 110% 30%,#be185d55 0,transparent 40%);
  background-attachment:fixed;
  font-family:"Rubik",system-ui,-apple-system,sans-serif; font-size:17px; line-height:1.45;
  min-height:100vh; -webkit-font-smoothing:antialiased;
}
a{color:var(--gold)}
.wrap{max-width:560px;margin:0 auto;padding:20px 16px 40px}
.logo{font-family:"Bungee",Impact,"Arial Black",sans-serif;font-size:22px;letter-spacing:1px;text-align:center;margin:4px 0 20px;color:var(--gold);text-shadow:3px 3px 0 var(--pink)}
.logo a{color:inherit;text-decoration:none}
.throne{
  position:relative;background:linear-gradient(160deg,var(--bg2),var(--card));
  border:3px solid var(--gold);border-radius:28px;padding:28px 20px 24px;text-align:center;
  box-shadow:8px 8px 0 var(--pink);
}
.crown{font-size:72px;line-height:1;display:inline-block;animation:bob 2.4s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-8px) rotate(6deg)}}
@media (prefers-reduced-motion:reduce){.crown{animation:none}}
.label{text-transform:uppercase;letter-spacing:3px;font-size:12px;font-weight:700;color:var(--teal);margin-top:8px}
.king{font-family:"Bungee",Impact,"Arial Black",sans-serif;font-size:clamp(30px,10vw,48px);line-height:1.05;margin:8px 0 14px;word-break:break-word}
.bubble{display:inline-block;background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:18px;font-weight:600;max-width:100%;word-break:break-word;position:relative}
.bubble::before{content:"";position:absolute;top:-10px;left:50%;margin-left:-10px;border:10px solid transparent;border-top:0;border-bottom-color:var(--ink)}
.bubble.empty{display:none}
.timer-label{margin-top:22px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:2px}
.timer{display:flex;justify-content:center;gap:8px;margin-top:8px}
.timer div{background:#0006;border:2px solid var(--line);border-radius:14px;padding:8px 0;min-width:62px}
.timer b{display:block;font-family:"Bungee",Impact,"Arial Black",sans-serif;font-size:24px;font-variant-numeric:tabular-nums;color:var(--gold)}
.timer span{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
.cta{
  display:block;width:100%;margin:28px 0 8px;padding:18px;border:0;border-radius:20px;cursor:pointer;
  background:var(--gold);color:var(--bg);font-family:"Bungee",Impact,"Arial Black",sans-serif;font-size:22px;
  box-shadow:0 6px 0 var(--gold-dark);transition:transform .08s,box-shadow .08s;
}
.cta:hover{filter:brightness(1.06)}
.cta:active{transform:translateY(4px);box-shadow:0 2px 0 var(--gold-dark)}
.cta:disabled{opacity:.6;cursor:wait}
.sub{text-align:center;color:var(--muted);font-size:14px;margin:0}
.banner{border-radius:16px;padding:12px 16px;margin-bottom:16px;font-weight:600;text-align:center}
.banner.ok{background:var(--teal);color:var(--bg)}
.banner.warn{background:#ffffff1a}
h2{font-family:"Bungee",Impact,"Arial Black",sans-serif;font-size:22px;margin:40px 0 12px;color:var(--gold)}
.board{list-style:none;padding:0;margin:0;display:grid;gap:10px}
.board li{display:flex;gap:12px;align-items:center;background:var(--card);border:2px solid var(--line);border-radius:18px;padding:12px 14px}
.board .rank{font-family:"Bungee",Impact,"Arial Black",sans-serif;font-size:20px;min-width:34px;text-align:center}
.board .who{flex:1;min-width:0}
.board .who strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.board .who small{display:block;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.board .dur{font-weight:700;color:var(--teal);white-space:nowrap;font-variant-numeric:tabular-nums}
.board .live{color:var(--pink);font-size:11px;font-weight:800;letter-spacing:1px;display:block;text-align:right}
.empty-board{color:var(--muted);text-align:center;padding:16px}
footer{margin-top:48px;padding-top:20px;border-top:2px solid var(--line);text-align:center;font-size:14px;color:var(--muted)}
footer nav{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 18px;margin-bottom:10px}
footer a{color:var(--muted)}
.noprize{display:inline-block;margin-top:6px;padding:4px 12px;border:2px solid var(--pink);border-radius:999px;color:var(--pink);font-weight:800;font-size:12px;letter-spacing:1px;text-transform:uppercase}
dialog{border:3px solid var(--gold);border-radius:24px;background:var(--bg2);color:var(--ink);padding:0;width:min(520px,calc(100% - 32px));box-shadow:8px 8px 0 var(--pink)}
dialog::backdrop{background:#0b0416cc}
dialog form{padding:22px 20px}
dialog h3{font-family:"Bungee",Impact,"Arial Black",sans-serif;margin:0 0 4px;font-size:24px;color:var(--gold)}
.field{margin-top:16px}
.field label{display:flex;justify-content:space-between;font-weight:700;font-size:14px;margin-bottom:6px}
.field label span{color:var(--muted);font-weight:500;font-variant-numeric:tabular-nums}
.field input{width:100%;font:inherit;font-size:17px;padding:12px 14px;border-radius:14px;border:2px solid var(--line);background:#0005;color:var(--ink)}
.field input:focus{outline:none;border-color:var(--gold)}
.hint{font-size:13px;color:var(--muted);margin:14px 0 0}
.error{background:var(--pink);color:#fff;border-radius:12px;padding:10px 12px;margin-top:14px;font-weight:600;display:none}
.error.show{display:block}
.close{float:right;background:none;border:0;color:var(--muted);font-size:28px;line-height:1;cursor:pointer;padding:0}
.page h1{font-family:"Bungee",Impact,"Arial Black",sans-serif;color:var(--gold)}
.page h2{font-size:18px;margin-top:28px}
.page p,.page li{color:var(--ink)}
`;

function layout(env: Env, title: string, body: string, nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="Pay £2, take the throne. Your name stays on top until someone dethrones you.">
<meta name="theme-color" content="#1a0b2e">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>👑</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bungee&family=Rubik:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style nonce="${nonce}">${STYLES}</style>
</head>
<body>
<div class="wrap">
<div class="logo"><a href="/">THE THRONE</a></div>
${body}
<footer>
  <nav>
    <a href="/terms">Terms</a>
    <a href="/privacy">Privacy policy</a>
    <a href="mailto:${escapeHtml(env.CONTACT_EMAIL)}">Contact</a>
  </nav>
  <div class="noprize">No cash prizes</div>
  <p>Bragging rights only. Every £2 is final.</p>
</footer>
</div>
</body>
</html>`;
}

export function homePage(env: Env, king: PublicReign | null, board: PublicReign[], nonce: string): string {
  const body = `
<div id="banner"></div>
<section class="throne" aria-live="polite">
  <div class="crown" aria-hidden="true">👑</div>
  <div class="label" id="label">${king ? "All hail the current king" : "The throne is empty"}</div>
  <div class="king" id="king">${king ? escapeHtml(king.name) : "Nobody… yet"}</div>
  <div class="bubble${king?.message ? "" : " empty"}" id="message">${king ? escapeHtml(king.message) : ""}</div>
  <div class="timer-label">Reigning for</div>
  <div class="timer" id="timer">
    <div><b id="t-d">0</b><span>days</span></div>
    <div><b id="t-h">00</b><span>hrs</span></div>
    <div><b id="t-m">00</b><span>min</span></div>
    <div><b id="t-s">00</b><span>sec</span></div>
  </div>
</section>

<button class="cta" id="open">Take the throne – £2</button>
<p class="sub">Your name stays on top until someone pays to knock you off.</p>

<h2>🏆 Longest reigns</h2>
<ol class="board" id="board"></ol>

<dialog id="dialog">
  <form id="form" novalidate>
    <button type="button" class="close" id="close" aria-label="Close">×</button>
    <h3>Claim the crown</h3>
    <p class="hint">£2. Your name and message go on the homepage for everyone to see.</p>
    <div class="field">
      <label for="f-name">Royal name <span id="c-name">0/${NAME_MAX}</span></label>
      <input id="f-name" name="name" maxlength="${NAME_MAX}" required autocomplete="nickname" placeholder="King Dave">
    </div>
    <div class="field">
      <label for="f-message">Royal decree <span id="c-message">0/${MESSAGE_MAX}</span></label>
      <input id="f-message" name="message" maxlength="${MESSAGE_MAX}" placeholder="Bow before me, peasants">
    </div>
    <div class="field">
      <label for="f-email">Email</label>
      <input id="f-email" name="email" type="email" required autocomplete="email" placeholder="you@example.com">
    </div>
    <p class="hint">We only use your email to tell you when you've been dethroned. Names and messages are checked before payment: no hate, sexual content, threats, bullying, private people's full names, phone numbers, addresses or links.</p>
    <div class="error" id="error" role="alert"></div>
    <button class="cta" id="submit" type="submit">Pay £2 &amp; take it</button>
  </form>
</dialog>

<script nonce="${nonce}">
(() => {
  let state = ${scriptJson({ king, board })};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const pad = (n) => String(n).padStart(2, "0");

  function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d) return d + "d " + h + "h";
    if (h) return h + "h " + m + "m";
    if (m) return m + "m " + (s % 60) + "s";
    return (s % 60) + "s";
  }

  function tick() {
    const ms = state.king ? Date.now() - state.king.since : 0;
    const s = Math.max(0, Math.floor(ms / 1000));
    $("t-d").textContent = Math.floor(s / 86400);
    $("t-h").textContent = pad(Math.floor(s % 86400 / 3600));
    $("t-m").textContent = pad(Math.floor(s % 3600 / 60));
    $("t-s").textContent = pad(s % 60);
    document.querySelectorAll("[data-live]").forEach((el) => {
      el.textContent = fmt(Number(el.dataset.base) + (Date.now() - Number(el.dataset.at)));
    });
  }

  function render() {
    const k = state.king;
    $("label").textContent = k ? "All hail the current king" : "The throne is empty";
    $("king").textContent = k ? k.name : "Nobody… yet";
    $("message").textContent = k ? k.message : "";
    $("message").classList.toggle("empty", !(k && k.message));
    const medals = ["🥇", "🥈", "🥉"];
    const now = Date.now();
    $("board").innerHTML = state.board.length ? state.board.map((r, i) =>
      '<li><span class="rank">' + (medals[i] || i + 1) + '</span>' +
      '<span class="who"><strong>' + esc(r.name) + '</strong>' + (r.message ? '<small>' + esc(r.message) + '</small>' : '') + '</span>' +
      '<span><span class="dur"' + (r.reigning ? ' data-live data-base="' + r.duration + '" data-at="' + now + '"' : '') + '>' + fmt(r.duration) + '</span>' +
      (r.reigning ? '<span class="live">REIGNING</span>' : '') + '</span></li>'
    ).join("") : '<li class="empty-board">No reigns yet. Be the first legend.</li>';
    tick();
  }

  async function refresh() {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.ok) { state = await res.json(); render(); }
    } catch {}
  }

  // Modal + form
  const dialog = $("dialog"), form = $("form"), err = $("error"), submit = $("submit");
  const counter = (input, out, max) => {
    const upd = () => { out.textContent = [...input.value].length + "/" + max; };
    input.addEventListener("input", upd); upd();
  };
  counter($("f-name"), $("c-name"), ${NAME_MAX});
  counter($("f-message"), $("c-message"), ${MESSAGE_MAX});
  $("open").addEventListener("click", () => { dialog.showModal(); $("f-name").focus(); });
  $("close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.classList.remove("show");
    submit.disabled = true;
    submit.textContent = "Checking with the royal court…";
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) { submit.textContent = "Off to payment…"; location.href = data.url; return; }
      err.textContent = data.error || "Something went wrong. Please try again.";
      err.classList.add("show");
    } catch {
      err.textContent = "Network error. Please try again.";
      err.classList.add("show");
    }
    submit.disabled = false;
    submit.textContent = "Pay £2 & take it";
  });

  // Returning from Stripe
  const params = new URLSearchParams(location.search);
  const banner = $("banner");
  const sessionId = params.get("session_id");
  if (params.has("cancelled")) {
    banner.innerHTML = '<div class="banner warn">Payment cancelled. The crown awaits whenever you are ready.</div>';
    history.replaceState(null, "", "/");
  } else if (sessionId) {
    banner.innerHTML = '<div class="banner ok">Payment received! Polishing your crown…</div>';
    history.replaceState(null, "", "/");
    let tries = 0;
    const poll = async () => {
      tries++;
      try {
        const res = await fetch("/api/session-status?id=" + encodeURIComponent(sessionId), { cache: "no-store" });
        const data = await res.json();
        if (data.crowned) {
          banner.innerHTML = '<div class="banner ok">👑 You have been crowned. Long may you reign!</div>';
          return refresh();
        }
      } catch {}
      if (tries < 30) setTimeout(poll, 2000);
      else banner.innerHTML = '<div class="banner warn">Payment received. Your crowning is taking a little longer than usual; refresh in a minute.</div>';
    };
    poll();
  }

  render();
  setInterval(tick, 1000);
  setInterval(refresh, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
})();
</script>`;
  return layout(env, "The Throne 👑", body, nonce);
}

export function adminPage(env: Env, reigns: Reign[], nonce: string, notice?: string): string {
  const rows = reigns
    .map(
      (r) => `<li>
  <span class="who">
    <strong>${escapeHtml(r.name)}</strong>
    <small>${r.message_removed ? "<em>message deleted</em>" : escapeHtml(r.message) || "<em>no message</em>"}</small>
    <small>${escapeHtml(r.email)} · ${new Date(r.paid_at).toISOString().replace("T", " ").slice(0, 19)} UTC</small>
  </span>
  <span class="actions">
  ${
    r.message_removed || !r.message
      ? ""
      : `<form method="post" action="/admin/delete-message">
    <input type="hidden" name="id" value="${r.id}">
    <button class="del" type="submit">Delete message</button>
  </form>`
  }
  ${
    r.name === ANONYMOUS
      ? ""
      : `<form method="post" action="/admin/anonymise-name">
    <input type="hidden" name="id" value="${r.id}">
    <button class="del alt" type="submit">Rename to ${ANONYMOUS}</button>
  </form>`
  }
  </span>
</li>`,
    )
    .join("");
  const body = `
<h2>Admin</h2>
${notice ? `<div class="banner ok">${escapeHtml(notice)}</div>` : ""}
<p class="sub">Most recent ${reigns.length} reigns. Deleting a message or renaming a king changes the site immediately and cannot be undone.</p>
<ol class="board">${rows || '<li class="empty-board">No reigns yet.</li>'}</ol>
<style nonce="${nonce}">
.board li{align-items:flex-start}
.del{background:var(--pink);color:#fff;border:0;border-radius:12px;padding:10px 12px;font:inherit;font-weight:700;cursor:pointer;white-space:nowrap}
.board .who small{white-space:normal}
.actions{display:grid;gap:6px}
.del.alt{background:#ffffff26}
</style>`;
  return layout(env, "Admin · The Throne", body, nonce);
}

export function termsPage(env: Env, nonce: string): string {
  return layout(
    env,
    "Terms · The Throne",
    `<article class="page">
<h1>Terms</h1>
<p>Last updated: ${new Date().getFullYear()}. By using The Throne you agree to these terms.</p>
<h2>What you're buying</h2>
<p>For £2 your chosen name and message are shown as the current king on this website until someone else pays. That's it: it is a novelty with no other value. <strong>There are no cash prizes</strong>, rewards, or guaranteed reign length.</p>
<h2>Payments and refunds</h2>
<p>Payments are processed by Stripe. Because your crown is shown immediately after payment, payments are non-refundable except where required by law. If you were charged but not crowned, contact us and we'll sort it out.</p>
<h2>Content rules</h2>
<p>Names and messages are automatically checked before payment. No hate speech, sexual content, threats, bullying, full names of private individuals, phone numbers, addresses, or links. We may remove any name or message at any time, without refund, if it breaks these rules or we consider it inappropriate.</p>
<h2>Liability</h2>
<p>The site is provided as-is. We aren't liable for downtime, lost reigns, or anything beyond the £2 you paid.</p>
<h2>Contact</h2>
<p><a href="mailto:${escapeHtml(env.CONTACT_EMAIL)}">${escapeHtml(env.CONTACT_EMAIL)}</a></p>
</article>`,
    nonce,
  );
}

export function privacyPage(env: Env, nonce: string): string {
  return layout(
    env,
    "Privacy · The Throne",
    `<article class="page">
<h1>Privacy policy</h1>
<h2>What we collect</h2>
<ul>
<li><strong>Name and message</strong>: shown publicly on the site and leaderboard.</li>
<li><strong>Email address</strong>: used only to tell you when you've been dethroned. Never shown publicly, never sold.</li>
<li><strong>Payment details</strong>: handled entirely by Stripe. We never see your card number.</li>
</ul>
<h2>Who processes it</h2>
<ul>
<li>Cloudflare (hosting and database)</li>
<li>Stripe (payments)</li>
<li>Anthropic (automated checking of names and messages before payment)</li>
<li>Resend (sending the "you've been dethroned" email)</li>
</ul>
<h2>Your rights</h2>
<p>You can ask us to see, correct, or delete your data at any time. Email <a href="mailto:${escapeHtml(env.CONTACT_EMAIL)}">${escapeHtml(env.CONTACT_EMAIL)}</a>.</p>
<h2>Cookies</h2>
<p>We don't set any tracking cookies.</p>
</article>`,
    nonce,
  );
}
