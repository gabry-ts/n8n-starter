# n8n-starter

n8n workflow versioning system. git repository as source of truth.

## structure

```
docker-compose.yml          # infra (postgres, redis) + includes
packages/
└── n8n/
    ├── docker-compose.yml  # n8n services
    ├── init/               # initialization container
    ├── workflows/          # workflow json files
    ├── credentials/        # credential manifest
    ├── hooks/              # external hooks
    └── scripts/            # cli tools
```

## quick start

```bash
cp .env.example .env
docker compose up -d
open http://localhost:12001
```

default login: `admin@admin.local` / `password`

## architecture

```
git repository (source of truth)
       |
       v
[n8n-init] ---> imports workflows, creates folders, bootstraps credentials
       |
       v
[n8n main] <---> [watch-server] ---> auto-exports on save
       |
    [redis] <---> [n8n-worker x N] ---> execute workflows
       |
  [postgres] ---> shared database
```

## commands

```bash
docker compose up -d        # start all services
docker compose down         # stop services
docker compose down -v      # stop and remove volumes (reset)
docker compose logs -f      # follow logs
```

## services

| service | port | description |
|---------|------|-------------|
| n8n | 12001 | n8n ui + api |
| n8n-worker | - | workflow executor (scalable) |
| postgres | 12000 | database |
| redis | - | job queue for workers |
| watch-server | 3456 | auto-export webhook receiver |

## scaling workers

```bash
docker compose up -d --scale n8n-worker=5
```

## adding packages

to add a new package (e.g., backend):

1. create `packages/backend/docker-compose.yml`
2. add to root docker-compose.yml:
```yaml
include:
  - packages/n8n/docker-compose.yml
  - packages/backend/docker-compose.yml
```

## environment variables

all env vars in `.env` are available to n8n services via `env_file`.
see `.env.example` for available options.
