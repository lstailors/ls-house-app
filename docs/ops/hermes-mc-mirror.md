# Hermes MC mirror (SPEC 072) — ops

## Status: LIVE (Phases 1–3)

Mission Control → **Hermes** tab on https://app.lstailors.com/mission-control?tab=hermes

| Surface | Source |
|---|---|
| Status / gateway | `GET /api/status` (public) via Edge proxy |
| Sessions / skills / cron / MCP / memory / analytics | Dashboard session login (server-side) |
| Chat one-shot | `lsh.mc_commands` (SPEC 069) |
| Live TUI stream | Deep-link → https://maestro.lstailors.com/chat |
| Desktop remote | Settings → Gateway → `https://maestro.lstailors.com` |

## Credentials (never in browser / git)

| Store | Keys |
|---|---|
| Vercel production | `HERMES_DASHBOARD_BASIC_AUTH_USERNAME`, `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD`, `HERMES_DASHBOARD_URL` |
| Studio keychain (optional local) | `hermes-dashboard-username` / `hermes-dashboard-password` (account `hermes`) |
| Machine config | `~/.hermes/config.yaml` → `dashboard.basic_auth.password_hash` only |

Rotate password:

```bash
# 1) keychain
security add-generic-password -U -s hermes-dashboard-password -a hermes -w 'NEW'

# 2) rehash machine config (not simone profile)
HERMES_HOME=~/.hermes ~/.hermes/hermes-agent/venv/bin/python - <<'PY'
import os, subprocess, sys
from pathlib import Path
os.environ['HERMES_HOME'] = str(Path.home()/'.hermes')
sys.path.insert(0, str(Path.home()/'.hermes'/'hermes-agent'))
from plugins.dashboard_auth.basic import hash_password
from hermes_cli.config import load_config, save_config
p = subprocess.run(['security','find-generic-password','-s','hermes-dashboard-password','-a','hermes','-w'],capture_output=True,text=True).stdout.strip()
cfg = load_config()
cfg.setdefault('dashboard',{}).setdefault('basic_auth',{})['username']='carl'
cfg['dashboard']['basic_auth']['password_hash']=hash_password(p)
cfg['dashboard']['basic_auth']['password']=''
save_config(cfg)
print('ok')
PY

# 3) restart dashboard process on :9119 (LaunchAgent KeepAlive)
# 4) vercel env update (no trailing newline) + redeploy
```

## Non-goals (stay Desktop)

File browser · terminal · git/worktrees · voice · full knowledge-graph canvas · WS/PTY embed in MC
