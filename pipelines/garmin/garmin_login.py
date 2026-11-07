#!/usr/bin/env python3
"""
garmin_login.py — run ONCE, locally, to create the GARMIN_TOKENS secret.

    pip install -U garminconnect
    python pipelines/garmin/garmin_login.py

Prompts for your Garmin email/password (and MFA code if you use one), then
prints a JSON token string (garminconnect 0.3.20+ format; older base64 blobs
no longer work). Put that blob in your repository secret
GARMIN_TOKENS (Settings → Secrets and variables → Actions). Tokens stay valid
for about a year; when the workflow starts failing with auth errors, run this
again and update the secret. Your password is used only for this login and
is never stored.
"""
import getpass

from garminconnect import Garmin


def main() -> None:
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password: ")
    g = Garmin(email=email, password=password, return_on_mfa=True)
    result1, result2 = g.login()
    if result1 == "needs_mfa":
        code = input("MFA code (check your email if you don't use an authenticator): ").strip()
        g.resume_login(result2, code)

    blob = g.client.dumps()
    if not blob.strip().startswith("{"):
        raise SystemExit("Unexpected token format — upgrade with: pip install -U garminconnect")

    with open("garmin_tokens.json", "w") as f:  # belt and braces; .gitignored
        f.write(blob)

    print("\n--- GARMIN_TOKENS (copy everything below into the secret) ---\n")
    print(blob)
    print("\n(Also saved to garmin_tokens.json here — delete it once the secret is set.)")
    dn = getattr(g, "display_name", None)
    if dn:
        print(f"\nYour Garmin display name is: {dn}\nIf daily stats come back empty, add it as a secret named GARMIN_DISPLAY_NAME.")


if __name__ == "__main__":
    main()
