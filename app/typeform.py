from app.schemas import Intake


CANONICAL_REFS = {name: name for name in Intake.model_fields}
CANONICAL_REFS.update({"candidate_name": "full_name", "candidate_email": "email", "candidate_phone": "phone", "resume_file": "resume_url", "availability_window": "availability"})
ROLE_REFS = {"tech_stack", "github_url", "case_study", "design_system", "acquisition_channels", "key_metrics", "linkedin_url"}


def parse_typeform(payload, settings):
    if not isinstance(payload, dict) or payload.get("event_type") != "form_response":
        raise ValueError("Only completed form_response events are accepted.")
    response = payload.get("form_response")
    if not isinstance(response, dict) or not response.get("submitted_at"):
        raise ValueError("A completed form response is required.")
    if response.get("form_id") != settings.typeform_form_id:
        raise ValueError("Unexpected Typeform form ID.")
    token = response.get("token")
    if not isinstance(token, str) or not 1 <= len(token) <= 150:
        raise ValueError("A response token is required.")
    answers = response.get("answers")
    if not isinstance(answers, list):
        raise ValueError("Answers must be an array.")
    normalized, role_answers = {}, {}
    for answer in answers:
        if not isinstance(answer, dict) or not isinstance(answer.get("field"), dict):
            raise ValueError("Malformed answer.")
        field = answer["field"]
        ref = settings.typeform_field_map.get(field.get("id"), field.get("ref"))
        key = CANONICAL_REFS.get(ref)
        if not key and ref not in ROLE_REFS:
            continue
        kind = answer.get("type")
        if kind == "choice":
            value = answer.get("choice", {}).get("label")
        elif kind == "choices":
            value = ", ".join(answer.get("choices", {}).get("labels", []))
        elif kind in {"text", "email", "phone_number", "url", "file_url", "number", "boolean", "date"}:
            value = answer.get(kind)
        else:
            raise ValueError("Unsupported answer type for a mapped field.")
        if ref in ROLE_REFS:
            role_answers[ref] = str(value)
        else:
            if key in normalized:
                raise ValueError("Duplicate answers for a mapped field.")
            normalized[key] = value
    normalized["role_answers"] = role_answers
    return Intake.model_validate(normalized), f"{settings.typeform_form_id}:{token}"
