# Central storage staging

This branch stages the ABFM operator flow. It must stay off the production service until account separation, backup retention, migration and acceptance testing have been verified.

## Staging deployment

Use the root render-staging.yaml as a separate Render Blueprint. It links to abfm-snagging-production via Render’s private database reference. The staging service uses the isolated snagging_stage schema. Use synthetic test data only. The production Blueprint on main should continue deploying the current app until acceptance is complete.

The staged web API shares cases, BOQ and attachments across authenticated browser and installed-app sessions. PostgreSQL transactions protect writes and reference allocation. A stale revision returns a conflict instead of overwriting recent changes. Browser storage is read only for the optional migration action. ABFM has the full workspace and can set the Rahati login under Rahati account. Rahati is redirected to its assigned workflow. It can submit an open quotation and can work on an awarded case during reinspection. After quotation submission, only ABFM sees the quote and award process. Client login is disabled. ABFM records acceptance manually and can export the current server state as JSON.

## Migration

Keep the browser profile, site data and original BOQ where the laptop records exist. Browser storage is tied to the app origin and browser profile. The import action must be tested at the production origin during an authorized cutover, after staging tests with synthetic data. Compare imported counts, source case IDs, BOQ references, quotation totals, photographs and signatures, then compare a second device. Re-importing identical records is safe. Conflicting case IDs, CAFM references or an existing different server BOQ stop migration and require reconciliation. Keep source data until the checks are signed off.

## Backup setup

The backup script requires PostgreSQL client tools of a compatible version and AWS CLI v2. Set up a private bucket with public access blocked and lifecycle retention of at least 30 days (35 days recommended). Grant the scheduled backup identity write and verification access to the database backup prefix. Use a distinct restore identity. Run the script daily from a host that can reach PostgreSQL over its internal network. Alert administrators on missed or failed jobs. Test restoring a backup into an isolated database, compare record and attachment counts and verify an authenticated user can load data. Never use production as a restore test target.

The root render-backup.yaml selects 02:00 Dubai daily and the supplied Dockerfile. The private S3 bucket, lifecycle retention, and prefix-only IAM access must be configured before applying it. Record a successful scheduled run and prove restore to an isolated database before cutover. Generated PDF and Excel artifact retention, administrative recovery, real migration and production acceptance checks remain release gates.
