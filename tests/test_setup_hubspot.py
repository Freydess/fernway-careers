import json

import httpx

from scripts.setup_hubspot import API, SPEC, setup


def fake_hubspot(groups, properties):
    """A tiny in-memory stand-in for HubSpot's contact properties API."""

    def handler(request):
        path = str(request.url).removeprefix(API)
        if path.startswith("/groups"):
            name = path.removeprefix("/groups").strip("/")
            if request.method == "GET":
                return httpx.Response(200, json=groups[name]) if name in groups else httpx.Response(404, json={"message": "not found"})
            body = json.loads(request.content)
            groups[body["name"]] = body
            return httpx.Response(201, json=body)
        name = path.strip("/")
        if request.method == "GET":
            return httpx.Response(200, json=properties[name]) if name in properties else httpx.Response(404, json={"message": "not found"})
        body = json.loads(request.content)
        properties[body["name"]] = body
        return httpx.Response(201, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def standard_properties():
    return {name: {"name": name, "type": "string"} for name in ("email", "firstname", "lastname", "phone", "website")}


def test_creates_the_group_and_ten_properties_then_reruns_cleanly():
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    groups, properties = {}, standard_properties()

    assert setup(fake_hubspot(groups, properties), spec) == []
    assert list(groups) == ["candidate_recruitment"]
    custom = [name for name in properties if name.startswith("candidate_")]
    assert len(custom) == 10
    assert "candidate_role_detail" in custom and "candidate_experience_years" in custom

    before = json.dumps(properties, sort_keys=True)
    assert setup(fake_hubspot(groups, properties), spec) == []
    assert json.dumps(properties, sort_keys=True) == before


def test_reports_a_property_with_the_wrong_type_or_missing_options():
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    groups = {"candidate_recruitment": {"name": "candidate_recruitment"}}
    properties = standard_properties()
    properties["candidate_experience_years"] = {"name": "candidate_experience_years", "type": "string"}
    properties["candidate_target_role"] = {"name": "candidate_target_role", "type": "enumeration", "options": [{"value": "engineering"}]}

    problems = setup(fake_hubspot(groups, properties), spec)

    assert any("candidate_experience_years" in problem and "number" in problem for problem in problems)
    assert any("candidate_target_role" in problem and "design" in problem for problem in problems)
