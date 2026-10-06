"""Create the HubSpot contact property group and the ten custom properties the backend writes.

Run from the project root:

    .\\.venv\\Scripts\\python.exe -m scripts.setup_hubspot

It asks for a HubSpot access token (a service key or private app token with the
crm.schemas.contacts.read and crm.schemas.contacts.write scopes) without showing it,
and never prints or stores it. Safe to run again: anything that already exists is kept.
The properties come from docs/hubspot-properties.json, so their internal names match
what app/integrations.py sends.
"""
import getpass
import json
import sys
from pathlib import Path

import httpx

API = "https://api.hubapi.com/crm/v3/properties/contacts"
SPEC = Path(__file__).resolve().parent.parent / "docs" / "hubspot-properties.json"
STANDARD = ("email", "firstname", "lastname", "phone", "website")


def _message(response):
    try:
        return response.json().get("message") or response.text
    except ValueError:
        return response.text


def _check_existing(name, current, wanted):
    """Problems with a property that already exists, or [] when it matches the spec."""
    if current.get("type") != wanted["type"]:
        return [f"{name} already exists as type {current.get('type')}, but the backend needs {wanted['type']}"]
    have = {option.get("value") for option in current.get("options") or []}
    missing = [option["value"] for option in wanted.get("options", []) if option["value"] not in have]
    return [f"{name} is missing the options: {', '.join(missing)}"] if missing else []


def setup(client, spec):
    """Creates whatever is missing. Returns a list of problems; empty means HubSpot is ready."""
    group = spec["group"]
    found = client.get(f"{API}/groups/{group['name']}")
    if found.status_code == 404:
        created = client.post(f"{API}/groups", json={key: group[key] for key in ("name", "label", "displayOrder")})
        if created.status_code != 201:
            return [f"Property group {group['name']}: HTTP {created.status_code} {_message(created)}"]
        print(f"Created the property group {group['name']}")
    elif found.status_code == 200:
        print(f"The property group {group['name']} already exists")
    else:
        return [f"Property group {group['name']}: HTTP {found.status_code} {_message(found)}"]

    problems = []
    for wanted in spec["properties"]:
        name = wanted["name"]
        found = client.get(f"{API}/{name}")
        if found.status_code == 200:
            issues = _check_existing(name, found.json(), wanted)
            problems += issues
            if not issues:
                print(f"{name} already exists")
        elif found.status_code == 404:
            created = client.post(API, json=wanted)
            if created.status_code == 201:
                print(f"Created {name}")
            else:
                problems.append(f"{name}: HTTP {created.status_code} {_message(created)}")
        else:
            problems.append(f"{name}: HTTP {found.status_code} {_message(found)}")

    for name in STANDARD:
        if client.get(f"{API}/{name}").status_code != 200:
            problems.append(f"HubSpot's standard property {name} is missing")
    return problems


def main():
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    token = getpass.getpass("HubSpot access token (hidden; paste it and press Enter): ").strip()
    if not token:
        print("No token entered, so nothing was changed.")
        return 1
    with httpx.Client(headers={"Authorization": f"Bearer {token}"}, timeout=20, follow_redirects=False) as client:
        check = client.get(f"{API}/email")
        if check.status_code == 401:
            print("HubSpot didn't accept that token (401). Copy it again and rerun.")
            return 1
        if check.status_code == 403:
            print("The token is missing a scope (403). Give it crm.schemas.contacts.read and crm.schemas.contacts.write.")
            return 1
        problems = setup(client, spec)
    if problems:
        print("\nNot finished:")
        for problem in problems:
            print(f"- {problem}")
        return 1
    print(f"\nHubSpot is ready: the {spec['group']['name']} group and all {len(spec['properties'])} custom properties exist.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
