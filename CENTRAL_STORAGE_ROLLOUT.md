# Central storage staging

This branch stages the ABFM operator flow. It must stay off the production service until account separation, backup retention, migration and acceptance testing have been verified.

## Staging deployment

Use the root render-staging.yaml as a separate Render Blueprint. It links to abfm-snagging-production via Render’s private database reference. The staging service uses the isolated snagging_stage schema. Use synthetic test data only. The production Blueprint on main should continue deploying the current app until acceptance is complete.

The staged web API shares cases, BOQ and attachments across authenticated browser and installed-app sessions. PostgreSQL transactions protect writes and reference allocation. A stale revision returns a conflict instead of overwriting recent changes. Browser storage is read only for the optional migration action. ABFM has the full workspace and can set the Rahati login under Rahati account. Rahati is redirected to its assigned workflow. It can submit an open quotation and can work on an awarded case during reinspection. After quotation submission, only ABFM sees the quote and award process. Client login is disabled. ABFM records acceptance manually and can export the current server state as JSON.

## Migration

Keep the browser profile, site data and original BOQ where the laptop records exist. Browser storage is tied to the app origin and browser profile. The import action must be tested at the production origin during an authorized cutover, after staging tests with synthetic data. Compare imported counts, source case IDs, BOQ references, quotation totals, photographs and signatures, then compare a second device. Re-importing identical records is safe. Conflicting case IDs, CAFM references or an existing different server BOQ stop migration and require reconciliation. Keep source data until the checks are signed off.

## Backup setup

Apply render-backup.yaml as a separate Render Blueprint from the centralized-storage branch. It references abfm-snagging-production and abfm-snagging-backups through their internal Render connection strings. The daily job runs at 02:00 Dubai time. It checks that the production schema exists, dumps the production public schema, validates the archive, and writes it in chunks to the separate backup database. Each committed snapshot carries a SHA-256 checksum and is kept for at least 35 days. Retention is applied only after a new verified snapshot succeeds. Retries on the same Dubai date preserve the saved copy.

Use Render's Cron Job logs to confirm each run. Monitor space on the backup database and increase it before the 35 retained dumps can reach the storage limit. Keep external database access closed. Access the backup database only through authorized private services or the Render administration workflow.

For an administrator recovery drill, run node ops/render-backup.js list then node ops/render-backup.js export YYYY-MM-DD output.dump inside an authorized environment with BACKUP_DATABASE_URL set. The export verifies the stored checksum. Restore into an isolated database using pg_restore --no-owner --no-acl and compare the case, BOQ, attachment and audit counts using the application. Do not restore over production during a drill.

The schedule is defined in GitHub. The Blueprint must be activated and a successful scheduled run and isolated restore must be verified before cutover. Generated PDF and Excel artifact retention, live browser migration and the production acceptance checks remain release gates.
