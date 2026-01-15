#!/bin/sh
set -e

echo "=== n8n-init: starting ==="

# database connection helper
run_sql() {
  PGPASSWORD=$DB_POSTGRESDB_PASSWORD psql -h $DB_POSTGRESDB_HOST -U $DB_POSTGRESDB_USER -d $DB_POSTGRESDB_DATABASE -t -c "$1" 2>/dev/null | tr -d ' \n'
}

run_sql_quiet() {
  PGPASSWORD=$DB_POSTGRESDB_PASSWORD psql -h $DB_POSTGRESDB_HOST -U $DB_POSTGRESDB_USER -d $DB_POSTGRESDB_DATABASE -c "$1" 2>/dev/null || true
}

# get project id (first project, usually personal)
get_project_id() {
  run_sql "SELECT id FROM project LIMIT 1;"
}

# generate uuid
gen_uuid() {
  cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || echo "$(date +%s)-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
}

# ============================================
# STEP 1: Install community nodes
# ============================================
echo "installing community nodes..."
if [ -f /community-nodes/community-nodes.txt ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # skip empty lines and comments
    line=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -z "$line" ] && continue
    echo "$line" | grep -q "^#" && continue

    echo "  installing: $line"
    cd /usr/local/lib/node_modules/n8n && npm install "$line" --save || echo "    failed to install $line"
  done < /community-nodes/community-nodes.txt
else
  echo "  no community-nodes.txt found"
fi

# ============================================
# STEP 2: Clear existing workflows
# ============================================
echo "clearing existing workflows..."
run_sql_quiet "TRUNCATE workflow_entity CASCADE;"

# ============================================
# STEP 3: Create folders from filesystem structure
# ============================================
echo "creating folders..."
PROJECT_ID=$(get_project_id)

if [ -z "$PROJECT_ID" ]; then
  echo "  warning: no project found, folders will not be created"
fi

# function to create folder and return its id
create_folder() {
  folder_name="$1"
  parent_id="$2"

  # check if folder exists
  if [ -n "$parent_id" ]; then
    existing_id=$(run_sql "SELECT id FROM folder WHERE name = '$folder_name' AND \"parentFolderId\" = '$parent_id' AND \"projectId\" = '$PROJECT_ID';")
  else
    existing_id=$(run_sql "SELECT id FROM folder WHERE name = '$folder_name' AND \"parentFolderId\" IS NULL AND \"projectId\" = '$PROJECT_ID';")
  fi

  if [ -n "$existing_id" ]; then
    echo "$existing_id"
    return
  fi

  # create new folder
  folder_id=$(gen_uuid)
  now=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

  if [ -n "$parent_id" ]; then
    run_sql_quiet "INSERT INTO folder (id, name, \"parentFolderId\", \"projectId\", \"createdAt\", \"updatedAt\") VALUES ('$folder_id', '$folder_name', '$parent_id', '$PROJECT_ID', '$now', '$now');"
  else
    run_sql_quiet "INSERT INTO folder (id, name, \"projectId\", \"createdAt\", \"updatedAt\") VALUES ('$folder_id', '$folder_name', '$PROJECT_ID', '$now', '$now');"
  fi

  echo "$folder_id"
}

# function to get or create folder path (e.g., "cliente-a/automazioni")
get_folder_id_for_path() {
  folder_path="$1"
  parent_id=""

  # split path by /
  echo "$folder_path" | tr '/' '\n' | while read -r part; do
    [ -z "$part" ] && continue
    parent_id=$(create_folder "$part" "$parent_id")
    echo "$parent_id" > /tmp/last_folder_id
  done

  cat /tmp/last_folder_id 2>/dev/null || echo ""
}

# scan /workflows for directories and create folders
if [ -n "$PROJECT_ID" ] && [ -d /workflows ]; then
  find /workflows -type d | while read -r dir; do
    # skip root directory
    [ "$dir" = "/workflows" ] && continue

    # get relative path
    rel_path=$(echo "$dir" | sed 's|^/workflows/||')

    echo "  creating folder: $rel_path"
    get_folder_id_for_path "$rel_path" > /dev/null
  done
fi


# ============================================
# STEP 4: Bootstrap credentials FIRST
# ============================================
echo "bootstrapping credentials..."
cd /app && npx ts-node bootstrap-credentials.ts || true

# ============================================
# STEP 5: Update credential IDs in workflows
# ============================================
echo "updating credential references in workflows..."

# build credential mapping (type -> id) from database
update_credential_ids() {
  file="$1"
  tmp_file="/tmp/workflow_updated.json"

  # get all credential types and their IDs from database
  PGPASSWORD=$DB_POSTGRESDB_PASSWORD psql -h $DB_POSTGRESDB_HOST -U $DB_POSTGRESDB_USER -d $DB_POSTGRESDB_DATABASE -t -A -F'|' -c "SELECT type, id, name FROM credentials_entity;" 2>/dev/null | while IFS='|' read -r cred_type cred_id cred_name; do
    [ -z "$cred_type" ] && continue
    # update all credential references of this type in the workflow
    # uses jq to find and replace credential IDs
    if jq -e ".nodes[].credentials.${cred_type}" "$file" > /dev/null 2>&1; then
      jq --arg type "$cred_type" --arg id "$cred_id" --arg name "$cred_name" '
        .nodes |= map(
          if .credentials[$type] then
            .credentials[$type].id = $id |
            .credentials[$type].name = $name
          else
            .
          end
        )
      ' "$file" > "$tmp_file" && mv "$tmp_file" "$file"
      echo "    updated $cred_type -> $cred_id ($cred_name)"
    fi
  done
}

# update all workflow files
find /workflows -name "*.json" -type f 2>/dev/null | while read -r f; do
  filename=$(basename "$f")
  case "$filename" in
    my-workflow*)
      continue
      ;;
  esac
  # copy to temp location and update (workflows are read-only mount)
  cp "$f" "/tmp/$(basename "$f")"
done

# update credential IDs in temp copies
for f in /tmp/*.json; do
  [ -f "$f" ] || continue
  update_credential_ids "$f"
done

# ============================================
# STEP 6: Import workflows with folder assignment
# ============================================
echo "importing workflows..."

import_workflow() {
  file="$1"
  original_file="${2:-$1}"

  # get relative directory path from ORIGINAL file (for folder structure)
  dir=$(dirname "$original_file")
  rel_dir=""

  if echo "$dir" | grep -q "^/workflows/"; then
    rel_dir=$(echo "$dir" | sed 's|^/workflows/||')
  elif [ "$dir" = "/workflows" ]; then
    rel_dir=""
  fi

  # extract workflow info from json
  WORKFLOW_NAME=$(jq -r '.name' "$file")
  IS_ACTIVE=$(jq -r '.active // false' "$file")
  IS_ARCHIVED=$(jq -r '.isArchived // false' "$file")

  echo "  importing: $WORKFLOW_NAME"
  [ -n "$rel_dir" ] && echo "    folder: $rel_dir"

  # import workflow
  n8n import:workflow --input="$file" || return 1

  # get workflow id
  WORKFLOW_ID=$(run_sql "SELECT id FROM workflow_entity WHERE name = '$WORKFLOW_NAME';")

  if [ -z "$WORKFLOW_ID" ]; then
    echo "    error: workflow not found after import"
    return 1
  fi

  # assign to folder if needed
  if [ -n "$rel_dir" ] && [ -n "$PROJECT_ID" ]; then
    FOLDER_ID=$(get_folder_id_for_path "$rel_dir")
    if [ -n "$FOLDER_ID" ]; then
      run_sql_quiet "UPDATE workflow_entity SET \"parentFolderId\" = '$FOLDER_ID' WHERE id = '$WORKFLOW_ID';"
      echo "    assigned to folder"
    fi
  fi

  # handle archived state
  if [ "$IS_ARCHIVED" = "true" ]; then
    echo "    archiving"
    run_sql_quiet "UPDATE workflow_entity SET \"isArchived\" = true WHERE id = '$WORKFLOW_ID';"
  fi

  # handle active state
  if [ "$IS_ACTIVE" = "true" ]; then
    echo "    publishing"
    n8n publish:workflow --id="$WORKFLOW_ID" || true
  else
    echo "    stays inactive"
  fi
}

# import workflows from /tmp (updated copies) with folder info from original path
find /workflows -name "*.json" -type f 2>/dev/null | while read -r f; do
  filename=$(basename "$f")
  case "$filename" in
    my-workflow*)
      echo "  skipping: $filename (default workflow)"
      continue
      ;;
  esac
  # use temp file (with updated credential IDs) but pass original for folder path
  tmp_file="/tmp/$filename"
  if [ -f "$tmp_file" ]; then
    import_workflow "$tmp_file" "$f"
  else
    import_workflow "$f" "$f"
  fi
done

echo "=== n8n-init: complete ==="
