import { config } from "../config";

// ─────────────────────────────────────────────────────────────
// Layout SSR des pages funnel (landing, vente, merci, légal).
// Servi par Express — pas de SPA ici : SEO, pixels, conversion.
// ─────────────────────────────────────────────────────────────

const CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6}
  .wrap{max-width:640px;margin:0 auto;padding:48px 20px}
  h1{color:#0f1b3d;font-size:2rem;margin-bottom:12px}
  h2{color:#0f1b3d;font-size:1.25rem;margin:24px 0 8px}
  p{margin-bottom:12px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;margin-top:24px}
  .btn{display:inline-block;background:#22a7f0;color:#fff;border:0;border-radius:10px;
       padding:14px 28px;font-size:1rem;font-weight:600;cursor:pointer;text-decoration:none}
  .btn:hover{background:#1b8fd0}
  input[type=email],input[type=text]{width:100%;border:1px solid #cbd5e1;border-radius:10px;
       padding:12px 14px;font-size:1rem;margin-bottom:12px}
  label.consent{display:flex;gap:8px;align-items:flex-start;font-size:.85rem;color:#475569;margin-bottom:16px}
  .muted{color:#64748b;font-size:.85rem}
  .price{font-size:2rem;font-weight:700;color:#0f1b3d;margin:8px 0}
  .badge{display:inline-block;background:#dbeafe;color:#1d4ed8;border-radius:999px;
       padding:4px 12px;font-size:.75rem;font-weight:600;margin-bottom:16px}
  footer{margin-top:48px;padding-top:24px;border-top:1px solid #e2e8f0;font-size:.8rem;color:#94a3b8}
  footer a{color:#64748b}
`;

function pixels(): string {
  let out = "";
  if (config.META_PIXEL_ID) {
    out += `
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${config.META_PIXEL_ID}');fbq('track','PageView');</script>`;
  }
  if (config.GTAG_ID) {
    out += `
<script async src="https://www.googletagmanager.com/gtag/js?id=${config.GTAG_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());gtag('config','${config.GTAG_ID}');</script>`;
  }
  return out;
}

export function page(title: string, body: string, opts?: { description?: string }): string {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  ${opts?.description ? `<meta name="description" content="${escapeHtml(opts.description)}"/>` : ""}
  <style>${CSS}</style>
  ${pixels()}
</head>
<body>
  <div class="wrap">
    ${body}
    <footer>
      Personnage et contenus générés par intelligence artificielle — assumé et transparent. ·
      <a href="/confidentialite">Confidentialité &amp; RGPD</a>
    </footer>
  </div>
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
