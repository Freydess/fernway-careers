from decimal import Decimal
from urllib.parse import quote, urlsplit

import httpx


class IntegrationError(Exception):
    def __init__(self, message, retryable=True, retry_after=0):
        super().__init__(message)
        self.retryable = retryable
        self.retry_after = retry_after


def rich_text(value):
    value = value or ""
    return [{"type": "text", "text": {"content": value[i:i + 2000]}} for i in range(0, len(value), 2000)]


def salary(data):
    if data.get("compensation_amount") is not None:
        return f"{Decimal(str(data['compensation_amount'])):.2f} {data['compensation_currency']} / {data['compensation_period']}"
    return data.get("compensation_expectations") or ""


def hubspot_properties(data):
    properties = {
        "email": data["email"], "phone": data.get("phone") or "", "website": data.get("portfolio_url") or "",
        "candidate_full_name": data["full_name"], "candidate_target_role": data["target_role"],
        "candidate_role_detail": data.get("role_detail") or "", "candidate_experience_level": data.get("experience_level") or "",
        "candidate_experience_years": data["experience_years"] if data.get("experience_years") is not None else "", "candidate_resume_url": data.get("resume_url") or "",
        "candidate_salary_expectations": salary(data), "candidate_availability": data.get("availability") or "",
        "candidate_fit_summary": data.get("fit_summary") or "", "candidate_application_status": data["status"],
        "candidate_application_id": data["id"], "candidate_timezone": data.get("timezone") or "",
    }
    return {key: str(value) for key, value in properties.items()}


def notion_properties(data):
    return {
        "Name": {"title": rich_text(data["full_name"])}, "Email": {"email": data["email"]},
        "Phone": {"phone_number": data.get("phone")}, "Role": {"select": {"name": data["target_role"].capitalize()}},
        "Experience": {"select": {"name": data["experience_level"].capitalize()} if data.get("experience_level") else None},
        "Experience Years": {"number": float(Decimal(data["experience_years"])) if data.get("experience_years") is not None else None},
        "Portfolio": {"url": data.get("portfolio_url")}, "Resume": {"url": data.get("resume_url")},
        "Salary Expectation": {"rich_text": rich_text(salary(data))}, "Availability": {"rich_text": rich_text(data.get("availability"))},
        "Summary Notes": {"rich_text": rich_text(data.get("fit_summary"))},
        "Status": {"status": {"name": data["status"].replace("_", " ").title()}},
        "Application ID": {"rich_text": rich_text(data["id"])},
        "Timezone": {"rich_text": rich_text(data.get("timezone"))},
        "Role Details": {"rich_text": rich_text(data.get("role_detail"))},
        "Role Answers": {"rich_text": rich_text("\n".join(f"{key}: {value}" for key, value in data.get("role_answers", {}).items()))},
    }


class Integrations:
    def __init__(self, settings, client=None):
        self.settings = settings
        self.client = client or httpx.Client(timeout=15, follow_redirects=False)
        self.owns_client = client is None

    def close(self):
        if self.owns_client:
            self.client.close()

    def request(self, target, method, url, *, allow_not_found=False, parse_json=True, **kwargs):
        try:
            response = self.client.request(method, url, **kwargs)
        except httpx.HTTPError:
            # Never persist response bodies / URLs, which can contain tokens or PII.
            raise IntegrationError(f"{target}: network error") from None
        if allow_not_found and response.status_code == 404:
            return None
        if not 200 <= response.status_code < 300:
            retryable = response.status_code in {408, 409, 425, 429} or response.status_code >= 500
            delay = response.headers.get("Retry-After", "0")
            delay = min(int(delay), 3600) if delay.isdigit() else 0
            raise IntegrationError(f"{target}: HTTP {response.status_code}", retryable, delay)
        if not parse_json:
            return {}
        try:
            result = response.json()
        except ValueError:
            raise IntegrationError(f"{target}: malformed JSON response") from None
        if not isinstance(result, dict):
            raise IntegrationError(f"{target}: malformed JSON response")
        return result

    def send(self, target, data, job_id):
        return getattr(self, target)(data, job_id)

    def hubspot(self, data, job_id):
        token = self.settings.hubspot_access_token.get_secret_value()
        if not token:
            raise IntegrationError("hubspot: credentials missing", retryable=False)
        headers = {"Authorization": f"Bearer {token}"}
        base = "https://api.hubapi.com/crm/v3/objects/contacts"
        lookup = f"{base}/{quote(data['email'], safe='')}"
        existing = self.request("hubspot", "GET", lookup, headers=headers, params={"idProperty": "email"}, allow_not_found=True)
        properties = hubspot_properties(data)
        if existing:
            result = self.request("hubspot", "PATCH", f"{base}/{quote(str(existing['id']), safe='')}", headers=headers, json={"properties": properties})
        else:
            try:
                result = self.request("hubspot", "POST", base, headers=headers, json={"properties": {**properties, "lifecyclestage": "lead"}})
            except IntegrationError as error:
                if str(error) != "hubspot: HTTP 409":
                    raise
                # Another request may have created the email between lookup and create.
                result = self.request("hubspot", "PATCH", lookup, headers=headers, params={"idProperty": "email"}, json={"properties": properties})
        if not result.get("id"):
            raise IntegrationError("hubspot: missing contact ID")
        return str(result["id"])

    def notion(self, data, job_id):
        token = self.settings.notion_token.get_secret_value()
        source = self.settings.notion_data_source_id
        if not token or not source:
            raise IntegrationError("notion: credentials or data source missing", retryable=False)
        headers = {"Authorization": f"Bearer {token}", "Notion-Version": self.settings.notion_api_version}
        base = "https://api.notion.com/v1"
        page_id = data.get("notion_page_id")
        if not page_id:
            found = self.request("notion", "POST", f"{base}/data_sources/{quote(source, safe='')}/query", headers=headers, json={"filter": {"property": "Application ID", "rich_text": {"equals": data["id"]}}, "page_size": 2})
            results = found.get("results")
            if not isinstance(results, list):
                raise IntegrationError("notion: malformed query response")
            if len(results) > 1 or found.get("has_more"):
                raise IntegrationError("notion: duplicate application IDs", retryable=False)
            page_id = results[0]["id"] if results else None
        properties = notion_properties(data)
        if page_id:
            result = self.request("notion", "PATCH", f"{base}/pages/{quote(page_id, safe='')}", headers=headers, json={"properties": properties})
        else:
            result = self.request("notion", "POST", f"{base}/pages", headers=headers, json={"parent": {"type": "data_source_id", "data_source_id": source}, "properties": properties})
        if not result.get("id"):
            raise IntegrationError("notion: missing page ID")
        return str(result["id"])

    def zapier(self, data, job_id):
        url = self.settings.zapier_webhook_url.get_secret_value()
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != "hooks.zapier.com" or not parsed.path.startswith("/hooks/catch/") or parsed.username or parsed.password:
            raise IntegrationError("zapier: a hooks.zapier.com HTTPS Catch Hook URL is required", retryable=False)
        self.request("zapier", "POST", url, parse_json=False, json={"event_id": job_id, "event_type": "application.sync", "application": data}, headers={"Idempotency-Key": job_id})
        return job_id
