"""Symmetric encryption for secrets stored at rest (TOTP seeds, provider credentials)."""

from __future__ import annotations

from collections.abc import Sequence

from cryptography.fernet import Fernet, InvalidToken, MultiFernet


class DecryptionError(Exception):
    """Raised when ciphertext cannot be decrypted with any configured key."""


class SecretBox:
    """Encrypts with the first key, decrypts with any key (supports rotation)."""

    def __init__(self, keys: Sequence[str]) -> None:
        if not keys:
            raise ValueError("at least one key is required")
        self._fernet = MultiFernet([Fernet(key.encode()) for key in keys])

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        try:
            return self._fernet.decrypt(ciphertext.encode()).decode()
        except InvalidToken as exc:
            raise DecryptionError("ciphertext could not be decrypted") from exc

    def rotate(self, ciphertext: str) -> str:
        """Re-encrypt with the current primary key."""
        return self._fernet.rotate(ciphertext.encode()).decode()


def generate_key() -> str:
    return Fernet.generate_key().decode()
