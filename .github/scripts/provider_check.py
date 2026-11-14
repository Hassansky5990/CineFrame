#!/usr/bin/env python3
"""CineFrame provider watchdog (runs in GitHub Actions on a daily cron).

Probes every configured embed provider's movie + TV routes, writes
provider-status.json (the client auto-deprioritizes providers reported
dead here), commits the refreshed status to main, and opens/closes a
`provider-watchdog` issue when providers die or recover.

Stdlib only. Env: GITHUB_TOKEN (from the workflow), GITHUB_REPOSITORY (auto).
Run locally with GITHUB_TOKEN unset to just write provider-status.json.
"""
import base64, json, os, socket, subprocess, time, urllib.request, urllib.error

REPO = os.environ.get("GITHUB_REPOSITORY", "Hassansky5990/CineFrame")
TOKEN = os.environ.get("GITHUB_TOKEN", "")
MAIN = "main"
APP_BRANCH = "upgrade/cineframe-combined"
UA = "Mozilla/5.0 (Linux; Android 11; SM-A125F) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36"
socket.setdefaulttimeout(12)

MOVIE_ID, TV_ID, TV_S, TV_E = 27205, 32118, 2, 5  # Inception; Generator Rex S2E5

PROVIDERS = {
    "vidzee":     ("https://player.vidzee.wtf/embed/movie/{id}",       "https://player.vidzee.wtf/embed/tv/{id}/{s}/{e}"),
    "2embedskin": ("https://www.2embed.skin/embed/{id}",               "https://www.2embed.skin/embedtv/{id}&s={s}&e={e}"),
    "vidlink":    ("https://vidlink.pro/movie/{id}",                   "https://vidlink.pro/tv/{id}/{s}/{e}"),
    "vidsrcsu":   ("https://vidsrc.su/embed/movie/{id}",               "https://vidsrc.su/embed/tv/{id}/{s}/{e}"),
    "vixsrc":     ("https://vixsrc.to/movie/{id}",                     "https://vixsrc.to/tv/{id}/{s}/{e}"),
    "2embedcc":   ("https://www.2embed.cc/embed/{id}",                 "https://www.2embed.cc/embedtv/{id}&s={s}&e={e}"),
    "vidnest":    ("https://vidnest.fun/movie/{id}",                   "https://vidnest.fun/tv/{id}/{s}/{e}"),
    "vidfast":    ("https://vidfast.vc/movie/{id}",                    "https://vidfast.vc/tv/{id}/{s}/{e}"),
    "vidsrcto":   ("https://vidsrc.to/embed/movie/{id}",               "https://vidsrc.to/embed/tv/{id}/{s}/{e}"),
    "vidrift":    ("https://embed.vidrift.net/embed/movie/{id}",       "https://embed.vidrift.net/embed/tv/{id}/{s}/{e}"),
    "multiembed": ("https://multiembed.mov/?video_id={id}&tmdb=1",     "https://multiembed.mov/?video_id={id}&tmdb=1&s={s}&e={e}"),
}

def probe(url):
    t0 = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.build_opener().open(req) as r:
            r.read(2048)
            xfo = (r.headers.get("X-Frame-Options") or "").strip().lower()
            csp = (r.headers.get("Content-Security-Policy") or "").lower()
            blocked = ("sameorigin" in xfo or "deny" in xfo
                       or "frame-ancestors 'none'" in csp or "frame-ancestors 'self'" in csp)
            return {"ok": True, "status": r.status, "latency_ms": int((time.time() - t0) * 1000),
                    "blocking": "advisory" if blocked else ""}
    except urllib.error.HTTPError as e:
        return {"ok": False, "status": e.code, "latency_ms": int((time.time() - t0) * 1000)}
    except Exception as e:
        return {"ok": False, "status": 0, "latency_ms": int((time.time() - t0) * 1000), "error": type(e).__name__}

def api(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}{path}", data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        body = r.read()
        return json.loads(body) if body else {}

def git(*args):
    subprocess.run(["git", *args], check=True, capture_output=True)

prev = {}
if os.path.exists("provider-status.json"):
    try:
        prev = json.load(open("provider-status.json")).get("providers", {})
    except Exception:
        prev = {}

now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
out = {"generated": now, "movie_id": MOVIE_ID, "tv_id": TV_ID, "providers": {}}
for name, (mv, tv) in PROVIDERS.items():
    m = probe(mv.format(id=MOVIE_ID))
    t = probe(tv.format(id=TV_ID, s=TV_S, e=TV_E))
    ok = m["ok"] and t["ok"]
    entry = {"ok": ok, "movie": m, "tv": t, "checked_at": now, "latency_ms": max(m["latency_ms"], t["latency_ms"])}
    if m.get("blocking") or t.get("blocking"):
        entry["blocking"] = "advisory"
    out["providers"][name] = entry
    print(f"{name:11s} ok={ok} movie={m['status']} tv={t['status']} {entry['latency_ms']}ms", flush=True)

json.dump(out, open("provider-status.json", "w"), indent=2)

# --- outage issue management (only with a token, i.e. inside Actions) ---
if TOKEN:
    down_now = sorted(n for n, v in out["providers"].items() if not v["ok"])
    down_before = sorted(n for n, v in prev.items() if v.get("ok") is False)
    try:
        open_issues = api("GET", "/issues?labels=provider-watchdog&state=open&per_page=10")
    except Exception:
        open_issues = []
    if down_now and down_now != down_before:
        body = ("The scheduled probe (movie + TV embed route per provider) reports these providers as unreachable from GitHub Actions:\n\n"
                + "\n".join(f"- **{n}**" for n in down_now)
                + "\n\nThey keep their code slots, but the client auto-deprioritizes them via `provider-status.json`.\n"
                  "Re-probe from the Actions tab (`workflow_dispatch`) when they are suspected back.")
        title = f"🚨 Provider watchdog: {', '.join(down_now)} unreachable"
        if open_issues:
            api("PATCH", f"/issues/{open_issues[0]['number']}", {"title": title, "body": body})
            for extra in open_issues[1:]:
                api("PATCH", f"/issues/{extra['number']}", {"state": "closed", "state_reason": "not_planned"})
        else:
            api("POST", "/issues", {"title": title, "body": body, "labels": ["provider-watchdog"]})
        print("outage issue updated:", title)
    elif not down_now and open_issues:
        for issue in open_issues:
            api("PATCH", f"/issues/{issue['number']}", {"state": "closed", "state_reason": "completed"})
        print("all providers back — watchdog issue(s) closed")

    # commit the refreshed status to main, and fast-forward the app branch so
    # the deployed site serves the same file same-origin.
    git("config", "user.name", "cineframe-watchdog")
    git("config", "user.email", "actions@github.com")
    git("add", "provider-status.json")
    subprocess.run(["git", "commit", "-m", f"chore(watchdog): provider status {now}"], capture_output=True)
    git("push", "origin", f"HEAD:{MAIN}")
    try:
        git("push", "origin", f"HEAD:{APP_BRANCH}")
        print("status fast-forwarded to app branch")
    except subprocess.CalledProcessError:
        print("app branch not fast-forwardable — client falls back to raw.githubusercontent")
