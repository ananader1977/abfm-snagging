import os
from urllib.parse import unquote, urlsplit

url = urlsplit(os.environ.pop("DATABASE_URL"))
if url.scheme not in {"postgres", "postgresql"} or not url.hostname or not url.path.strip("/"):
    raise SystemExit("A valid Render database connection is required")
os.environ.update({
    "PGHOST": url.hostname,
    "PGPORT": str(url.port or 5432),
    "PGDATABASE": unquote(url.path.lstrip("/")),
    "PGUSER": unquote(url.username or ""),
    "PGPASSWORD": unquote(url.password or ""),
})
os.execvp("bash", ["bash", "/usr/local/bin/abfm-backup"])
