# n8n

workflow storage and synchronization. git repository as source of truth.

## structure

```
n8n/
├── docker-compose.yml  # n8n services (included from root)
├── init/               # initialization container
├── workflows/          # workflow json files (subdirs = n8n folders)
├── credentials/        # credential definitions
│   └── manifest.yml    # credential manifest with env mappings
├── hooks/              # n8n external hooks
├── scripts/            # cli tools (watch-server, export, import)
└── community-nodes.txt # community nodes to install
```

## auto-export

workflows are automatically exported when saved in n8n via external hooks.
folder structure in n8n is preserved in the filesystem.

flow: n8n save -> hook -> watch-server -> filesystem

## auto-sync

workflows and credentials are automatically synced:
- **export**: on save in n8n ui via external hooks -> watch-server -> filesystem
- **import**: on startup via init container -> n8n import command

## credentials

define in `credentials/manifest.yml`:

```yaml
credentials:
  - name: "My API"
    type: "httpHeaderAuth"
    env_mapping:
      name: "MY_HEADER_NAME"
      value: "MY_HEADER_VALUE"
```

add env vars to root `.env` file:

```
MY_HEADER_NAME=X-Api-Key
MY_HEADER_VALUE=secret-value
```

optionally document defaults in `docker-compose.yml` (x-n8n-credential-yaml-file):

```yaml
x-n8n-credential-yaml-file: &n8n-credential-yaml-file
  MY_HEADER_NAME: ${MY_HEADER_NAME:-X-Api-Key}
  MY_HEADER_VALUE: ${MY_HEADER_VALUE:-}
```

## community nodes

list npm packages in `community-nodes.txt`:

```
n8n-nodes-evolution-api
```
