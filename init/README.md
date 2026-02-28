# n8n-init

initialization container for n8n. runs once on startup to configure the instance.

## what it does

1. **community nodes**: installs packages listed in `community-nodes.txt`
2. **workflows**: clears existing workflows and imports from `/workflows` directory
3. **folders**: creates n8n folders matching the filesystem structure
4. **owner account**: creates owner user if `N8N_OWNER_EMAIL` and `N8N_OWNER_PASSWORD` are set
5. **credentials**: bootstraps credentials from `credentials/manifest.yml`

## environment variables

| variable | description | default |
|----------|-------------|---------|
| `DB_POSTGRESDB_HOST` | postgres host | - |
| `DB_POSTGRESDB_PORT` | postgres port | `5432` |
| `DB_POSTGRESDB_DATABASE` | database name | - |
| `DB_POSTGRESDB_USER` | database user | - |
| `DB_POSTGRESDB_PASSWORD` | database password | - |
| `N8N_ENCRYPTION_KEY` | encryption key for credentials | - |
| `N8N_OWNER_EMAIL` | owner account email (optional) | - |
| `N8N_OWNER_PASSWORD` | owner account password (optional) | - |

## files

- `init.sh` - main initialization script
- `bootstrap-credentials.js` - owner account and credentials setup

## usage

runs automatically via docker compose. to run manually:

```bash
docker compose run --rm n8n-init
```
