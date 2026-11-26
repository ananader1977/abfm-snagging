# Central storage staging

This branch stages the ABFM operator flow. It must stay off the production service until account separation, backup retention, migration and acceptance testing have been verified.

## Staging deployment

Provision a separate PostgreSQL database in the app region. In a separate staging web service set DATABASE_URL to its internal connection string. Keep credentials in the host’s environment settings. Install package dependencies with npm install before starting the web service. Startup initializes the tables in the selected database and fails if a database connection is unavailable. The production Blueprint on main should continue deploying the current app during testing.

The staged web API shares cases, BOQ and attachments across authenticated browser and installed-app sessions. PostgreSQL transactions protect writes and reference allocation. A stale revision returns a conflict instead of overwriting recent changes. Browser storage is read only for the optional migration action. The staging scope is a single, authenticated ABFM operator role.

## Migration

Keep the browser profile, site data and original BOQ where the laptop records exist. Browser storage is tied to the app origin and browser profile. The import action must be tested at the production origin during an authorized cutover, after staging tests with synthetic data. Compare imported counts, source case IDs, BOQ references, quotation totals, photographs and signatures, then compare a second device. Re-importing identical records is safe. Conflicting case IDs, CAFM references or an existing different server BOQ stop migration and require reconciliation. Keep source data until the checks are signed off.

## Backup setup

The backup script requires PostgreSQL client tools of a compatible version and AWS CLI v2. Set up a private bucket with public access blocked and lifecycle retention of at least 30 days (35 days recommended). Grant the scheduled backup identity write and verification access to the database backup prefix. Use a distinct restore identity. Run the script daily from a host that can reach PostgreSQL over its internal network. Alert administrators on missed or failed jobs. Test restoring a backup into an isolated database, compare record and attachment counts and verify an authenticated user can load data. Never use production as a restore test target.

The schedule and bucket are not provisioned by this branch. Separate supplier and client accounts, assigned-record API permissions, document artifact retention, an administrative recovery interface, and all production acceptance checks remain release gates.
