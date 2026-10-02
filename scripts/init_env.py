"""Create local secrets without overwriting an existing environment file."""
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
env = root / ".env"
if env.exists():
    print("Existing .env preserved.")
else:
    template = (root / ".env.example").read_text(encoding="utf-8")
    template = template.replace("replace-with-a-random-admin-secret-of-32-or-more-characters", secrets.token_urlsafe(40))
    template = template.replace("replace-with-a-different-random-intake-secret-of-32-or-more-characters", secrets.token_urlsafe(40))
    env.write_text(template, encoding="utf-8")
    print("Created .env with separate random API secrets; syncing is disabled.")
