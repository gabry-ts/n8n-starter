FROM node:20-alpine

RUN apk add --no-cache postgresql-client jq curl
RUN npm install -g n8n@2.3.5

WORKDIR /app
RUN npm init -y && npm install pg bcrypt js-yaml typescript ts-node @types/node @types/pg @types/bcrypt @types/js-yaml

COPY init.sh /init.sh
COPY bootstrap-credentials.ts /app/bootstrap-credentials.ts
COPY tsconfig.json /app/tsconfig.json
RUN chmod +x /init.sh

ENTRYPOINT ["/bin/sh", "/init.sh"]
