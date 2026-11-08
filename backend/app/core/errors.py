"""Framework-independent domain errors.

Services raise these; the HTTP layer (`app.core.http`) maps them to responses.
Messages must be safe to show to the client (no secrets, no internals).
"""

from __future__ import annotations

from enum import StrEnum


class ErrorKind(StrEnum):
    VALIDATION = "validation"
    UNAUTHENTICATED = "unauthenticated"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    RATE_LIMITED = "rate_limited"


class DomainError(Exception):
    kind: ErrorKind = ErrorKind.VALIDATION
    code: str = "domain_error"
    message: str = "The request could not be processed."

    def __init__(self, message: str | None = None, *, code: str | None = None) -> None:
        if message is not None:
            self.message = message
        if code is not None:
            self.code = code
        super().__init__(self.message)


class ValidationFailed(DomainError):
    kind = ErrorKind.VALIDATION
    code = "validation_failed"


class Unauthenticated(DomainError):
    kind = ErrorKind.UNAUTHENTICATED
    code = "unauthenticated"
    message = "Authentication required."


class Forbidden(DomainError):
    kind = ErrorKind.FORBIDDEN
    code = "forbidden"
    message = "You are not allowed to perform this action."


class NotFound(DomainError):
    kind = ErrorKind.NOT_FOUND
    code = "not_found"
    message = "Resource not found."


class Conflict(DomainError):
    kind = ErrorKind.CONFLICT
    code = "conflict"
    message = "The resource already exists or is in a conflicting state."


class RateLimited(DomainError):
    kind = ErrorKind.RATE_LIMITED
    code = "rate_limited"
    message = "Too many attempts. Try again later."
