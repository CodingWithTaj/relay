#!/usr/bin/env bash
# Deploy Relay to Azure Container Apps with Azure Database for PostgreSQL.
#
# Needs the Azure CLI (az login first) and an Azure subscription; Azure for
# Students credit covers it. Rough cost: the B1ms database is the main expense
# (about US$13/month); the container app scales to one small replica.
# Run from the repository root:  ADMIN_TOKEN=... ./infra/azure-deploy.sh
set -euo pipefail

: "${ADMIN_TOKEN:?Set ADMIN_TOKEN to the secret for managing monitors}"
LOCATION="${LOCATION:-canadacentral}"
RG="${RG:-relay-rg}"
SUFFIX="${SUFFIX:-$RANDOM}"
APP="relay-$SUFFIX"
PG="relay-db-$SUFFIX"
PG_PASSWORD="${PG_PASSWORD:-}"
[ -n "$PG_PASSWORD" ] || PG_PASSWORD="$(openssl rand -hex 16)"  # hex: safe inside a URL

az extension add --name containerapp --upgrade --only-show-errors
az group create --name "$RG" --location "$LOCATION" --output none

echo "Creating PostgreSQL (takes a few minutes)…"
az postgres flexible-server create --resource-group "$RG" --name "$PG" --location "$LOCATION" \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 \
  --admin-user relay --admin-password "$PG_PASSWORD" --public-access 0.0.0.0 --yes --output none
az postgres flexible-server db create --resource-group "$RG" --server-name "$PG" --database-name relay --output none

echo "Building and deploying the app…"
az containerapp up --name "$APP" --resource-group "$RG" --location "$LOCATION" --source . \
  --ingress external --target-port 8000 \
  --env-vars "DATABASE_URL=postgresql+psycopg://relay:${PG_PASSWORD}@${PG}.postgres.database.azure.com:5432/relay?sslmode=require" \
             "ADMIN_TOKEN=${ADMIN_TOKEN}" "STATUS_PAGE_TITLE=Service status"
# one replica always on, so checks keep running between visits
az containerapp update --name "$APP" --resource-group "$RG" --min-replicas 1 --max-replicas 1 --output none

URL=$(az containerapp show --name "$APP" --resource-group "$RG" --query properties.configuration.ingress.fqdn -o tsv)
echo
echo "Relay is live at https://$URL"
echo "Database password (store it somewhere safe): $PG_PASSWORD"
echo "Remove everything later with: az group delete --name $RG"
