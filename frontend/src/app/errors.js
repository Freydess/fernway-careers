// One error type for both API versions (live and demo), so pages handle failures the
// same way: `status` is the HTTP status (0 = no connection), `fields` lists form errors.

export class ApiError extends Error {
  constructor(status, message, { code = null, fields = [] } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** Builds an error from a FastAPI response body ({ detail: string | [{ loc, msg }] }). */
  static fromResponse(status, data) {
    const detail = data?.detail;
    if (Array.isArray(detail)) {
      const fields = detail
        .map((item) => ({ field: String(item?.loc?.at?.(-1) ?? item?.field ?? ''), message: String(item?.msg ?? item?.message ?? 'Check this field') }))
        .filter((item) => item.field);
      return new ApiError(status, 'Some details need fixing.', { fields });
    }
    return new ApiError(status, typeof detail === 'string' && detail ? detail : defaultMessage(status), { code: typeof data?.code === 'string' ? data.code : null });
  }
}

function defaultMessage(status) {
  if (status === 401) return 'Please sign in first.';
  if (status === 403) return 'Your account can’t do that.';
  if (status === 404) return 'We couldn’t find that. It may have been removed.';
  if (status === 409) return 'That changed in the meantime. Reload the page and try again.';
  if (status === 429) return 'Too many tries. Wait a minute, then try again.';
  if (status >= 500) return 'Something went wrong on our side. Try again in a minute.';
  return 'That didn’t work. Try again.';
}
