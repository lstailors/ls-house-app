# Hermes MC mirror credentials

Dashboard password is hash-only in `~/.hermes/config.yaml`. To unlock
sessions/skills/cron API panels inside Mission Control Hermes tab:

## Studio keychain
```bash
security add-generic-password -U -s hermes-dashboard-username -a hermes -w carl
security add-generic-password -U -s hermes-dashboard-password -a hermes -w 'YOUR_DASHBOARD_PASSWORD'
```

## Vercel (app.lstailors.com Edge proxy)
```bash
# same values
vercel env add HERMES_DASHBOARD_BASIC_AUTH_USERNAME production
vercel env add HERMES_DASHBOARD_BASIC_AUTH_PASSWORD production
# optional override
# HERMES_DASHBOARD_URL=https://maestro.lstailors.com
```

Public status + deep links work without these. Auth is server-side only —
never sent to the browser.
