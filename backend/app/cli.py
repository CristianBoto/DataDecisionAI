"""Administración de invitaciones (sin endpoints públicos: solo desde el servidor).

Uso (desde backend/):
    python -m app.cli invite --label "Docente" --days 14
    python -m app.cli list
    python -m app.cli revoke <id>

El código se muestra UNA sola vez: la base guarda solo su huella SHA-256.
Entregalo por un canal privado; nunca lo subas al repositorio.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone

from app.core.config import get_settings
from app.services.auth import AuthService
from app.services.database import Database


def _date(timestamp: float | None) -> str:
    if timestamp is None:
        return "-"
    return datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Invitaciones de DataDecision AI")
    sub = parser.add_subparsers(dest="command", required=True)
    invite = sub.add_parser("invite", help="crea una invitación y muestra su código una vez")
    invite.add_argument("--label", required=True, help="a quién se entrega (sin datos sensibles)")
    invite.add_argument("--days", type=float, default=14, help="días de vigencia (por defecto 14)")
    sub.add_parser("list", help="lista las invitaciones (sin códigos)")
    revoke = sub.add_parser("revoke", help="revoca una invitación y cierra sus sesiones")
    revoke.add_argument("id")
    args = parser.parse_args(argv)

    settings = get_settings()
    auth = AuthService(
        Database(settings.database_path),
        session_ttl_seconds=settings.session_ttl_hours * 3600,
        max_sessions=settings.max_sessions_per_invitation,
    )
    if args.command == "invite":
        if not 0 < args.days <= 90:
            parser.error("--days debe estar entre 0 y 90")
        invitation_id, code = auth.create_invitation(args.label, args.days)
        print(f"Invitación {invitation_id} creada ({args.label}), vigente {args.days:g} días.")
        print(f"Código (se muestra solo esta vez): {code}")
    elif args.command == "list":
        for row in auth.list_invitations():
            state = "revocada" if row["revoked_at"] else "vigente"
            print(f"{row['id']}  {state:9}  vence {_date(row['expires_at'])}  sesiones activas: {row['active_sessions']}  {row['label']}")
    elif args.command == "revoke":
        print("Revocada." if auth.revoke_invitation(args.id) else "No existe o ya estaba revocada.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
