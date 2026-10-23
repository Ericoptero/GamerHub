"""Hash de senha com scrypt da stdlib (sem dependência nova). Formato: scrypt$n$r$p$salt$hash (base64)."""

import base64
import hashlib
import hmac
import secrets

N, R, P = 2**14, 8, 1
MIN_LENGTH = 8


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=N, r=R, p=P, dklen=32)
    return f"scrypt${N}${R}${P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        expected = base64.b64decode(digest)
        calc = hashlib.scrypt(
            password.encode("utf-8"), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
    except ValueError:
        return False
    return algo == "scrypt" and hmac.compare_digest(calc, expected)


# Usado quando o usuário não existe, para o login levar o mesmo tempo nos dois casos.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
