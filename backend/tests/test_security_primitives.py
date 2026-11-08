"""Unit tests for security primitives (no database)."""

from __future__ import annotations

import time

import pytest

from app.core.security import passwords, totp
from app.core.security.encryption import DecryptionError, SecretBox, generate_key
from app.core.security.tokens import constant_time_equals, generate_token, hash_token


class TestPasswords:
    def test_hash_and_verify(self) -> None:
        hashed = passwords.hash_password("a very long password")
        assert hashed.startswith("$argon2id$")
        assert passwords.verify_password(hashed, "a very long password")
        assert not passwords.verify_password(hashed, "wrong password!!")

    def test_missing_hash_never_verifies(self) -> None:
        assert not passwords.verify_password(None, "personal-os-dummy-password")

    def test_garbage_hash_is_rejected(self) -> None:
        assert not passwords.verify_password("not-a-hash", "whatever")


class TestTokens:
    def test_tokens_are_unique_and_long(self) -> None:
        tokens = {generate_token() for _ in range(100)}
        assert len(tokens) == 100
        assert all(len(t) >= 43 for t in tokens)

    def test_hash_is_deterministic_sha256(self) -> None:
        assert hash_token("abc") == hash_token("abc")
        assert len(hash_token("abc")) == 32

    def test_constant_time_equals(self) -> None:
        assert constant_time_equals("x", "x")
        assert not constant_time_equals("x", "y")


class TestSecretBox:
    def test_round_trip(self) -> None:
        box = SecretBox([generate_key()])
        ciphertext = box.encrypt("JBSWY3DPEHPK3PXP")
        assert "JBSWY3DPEHPK3PXP" not in ciphertext
        assert box.decrypt(ciphertext) == "JBSWY3DPEHPK3PXP"

    def test_key_rotation(self) -> None:
        old_key, new_key = generate_key(), generate_key()
        old_box = SecretBox([old_key])
        ciphertext = old_box.encrypt("secret")
        rotated_box = SecretBox([new_key, old_key])
        assert rotated_box.decrypt(ciphertext) == "secret"
        rotated = rotated_box.rotate(ciphertext)
        assert SecretBox([new_key]).decrypt(rotated) == "secret"

    def test_wrong_key_raises(self) -> None:
        ciphertext = SecretBox([generate_key()]).encrypt("secret")
        with pytest.raises(DecryptionError):
            SecretBox([generate_key()]).decrypt(ciphertext)

    def test_requires_a_key(self) -> None:
        with pytest.raises(ValueError, match="at least one key"):
            SecretBox([])


class TestTotp:
    secret = totp.generate_secret()

    def test_current_code_matches(self) -> None:
        now = time.time()
        step = totp.matching_step(self.secret, totp.current_code(self.secret, now), None, at=now)
        assert step == int(now // totp.TOTP_INTERVAL_SECONDS)

    def test_replay_of_same_step_is_rejected(self) -> None:
        now = time.time()
        code = totp.current_code(self.secret, now)
        step = totp.matching_step(self.secret, code, None, at=now)
        assert step is not None
        assert totp.matching_step(self.secret, code, step, at=now) is None

    def test_older_step_is_rejected_after_newer_was_used(self) -> None:
        now = time.time()
        previous = totp.current_code(self.secret, now - totp.TOTP_INTERVAL_SECONDS)
        current_step = int(now // totp.TOTP_INTERVAL_SECONDS)
        assert totp.matching_step(self.secret, previous, current_step, at=now) is None

    def test_drift_window(self) -> None:
        now = time.time()
        next_code = totp.current_code(self.secret, now + totp.TOTP_INTERVAL_SECONDS)
        far_code = totp.current_code(self.secret, now + 5 * totp.TOTP_INTERVAL_SECONDS)
        assert totp.matching_step(self.secret, next_code, None, at=now) is not None
        if far_code != next_code and far_code != totp.current_code(self.secret, now):
            assert totp.matching_step(self.secret, far_code, None, at=now) is None

    @pytest.mark.parametrize("code", ["", "12345", "1234567", "abcdef", "12 456"])
    def test_malformed_codes(self, code: str) -> None:
        assert totp.matching_step(self.secret, code, None) is None

    def test_provisioning_uri(self) -> None:
        uri = totp.provisioning_uri(self.secret, "me@example.test", "Personal OS")
        assert uri.startswith("otpauth://totp/")
        assert "issuer=Personal%20OS" in uri
