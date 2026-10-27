"""Control del consumo de la IA: presupuesto global, cuotas por visitante y concurrencia.

- Estimación previa del costo máximo (entrada estimada + salida máxima).
- RESERVA antes de enviar, dentro de una transacción exclusiva de SQLite: si el
  presupuesto global, el del visitante o sus solicitudes del día no alcanzan, no
  se envía. Así, ni en paralelo se puede gastar de más.
- Una sola consulta en curso por visitante (la reserva abierta lo indica).
- Registro del consumo REAL informado por el proveedor (tokens y costo), sin
  contenido: ni objetivo, ni mensajes, ni nombres de columna.
- Persistente: sobrevive a reinicios y redespliegues si la base está en un
  disco persistente (obligatorio en producción). Una reserva que quedó abierta
  (por ejemplo, el proceso se cortó durante el envío) se cobra por su máximo.
- Si la base no se puede leer o escribir, se deniega el envío (falla cerrada).

No reemplaza el límite de gasto configurado en OpenAI Platform: son complementarios.
Las estimaciones pueden diferir del consumo real.
"""

from __future__ import annotations

import json
import math
import secrets
import sqlite3
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import ConfigurationError
from app.services.ai_errors import AIGatewayError
from app.services.database import Database

# USD por millón de tokens (entrada, salida), precios estándar publicados por OpenAI
# para contextos cortos. Verificados el 25/10/2026; ver docs/SEGURIDAD.md.
MODEL_PRICES_PER_1M: dict[str, tuple[float, float]] = {
    "gpt-6-luna": (0.10, 0.50),
    "gpt-5-nano": (0.05, 0.40),
    "gpt-4.1-nano": (0.10, 0.40),
    "gpt-4o-mini": (0.15, 0.60),
}

# Estimación conservadora: ~3 caracteres por token (el español suele rendir algo más).
CHARS_PER_TOKEN = 3
# Una reserva abierta más tiempo que esto se considera abandonada y se cobra completa.
STALE_RESERVATION_SECONDS = 600
UNVERIFIABLE = "No se pudo verificar el presupuesto de la IA. No se envió nada."


def estimate_tokens(*texts: str) -> int:
    return math.ceil(sum(len(t) for t in texts) / CHARS_PER_TOKEN)


def model_prices(model: str, input_override: float | None, output_override: float | None) -> tuple[float, float] | None:
    if input_override is not None and output_override is not None:
        return input_override, output_override
    return MODEL_PRICES_PER_1M.get(model)


def cost_usd(prices: tuple[float, float], input_tokens: int, output_tokens: int) -> float:
    return (input_tokens * prices[0] + output_tokens * prices[1]) / 1_000_000


@dataclass(frozen=True)
class Reservation:
    id: str
    user_id: str
    amount_usd: float


@dataclass(frozen=True)
class UsageStatus:
    """Lo que ve un visitante: su cuota, acotada por lo que queda del presupuesto global."""

    user_budget_usd: float
    user_spent_usd: float
    remaining_usd: float
    requests_today: int
    max_requests_per_day: int


class AIBudget:
    def __init__(
        self,
        db: Database,
        *,
        budget_usd: float,
        user_budget_usd: float,
        user_daily_requests: int,
        global_daily_requests: int,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.db = db
        self.budget_usd = budget_usd
        self.user_budget_usd = user_budget_usd
        self.user_daily_requests = user_daily_requests
        self.global_daily_requests = global_daily_requests
        self._clock = clock

    def _day(self) -> str:
        return datetime.fromtimestamp(self._clock(), timezone.utc).date().isoformat()

    # --- Lecturas -------------------------------------------------------------

    @staticmethod
    def _totals(conn: sqlite3.Connection, user_id: str, day: str) -> dict[str, float]:
        def scalar(sql: str, params: tuple = ()) -> float:
            return float(conn.execute(sql, params).fetchone()[0] or 0)

        return {
            "global_spent": scalar("SELECT SUM(cost_usd) FROM ai_usage")
            + scalar("SELECT SUM(amount_usd) FROM ai_reservations"),
            "user_spent": scalar("SELECT SUM(cost_usd) FROM ai_usage WHERE user_id = ?", (user_id,))
            + scalar("SELECT SUM(amount_usd) FROM ai_reservations WHERE user_id = ?", (user_id,)),
            "user_requests": scalar("SELECT COUNT(*) FROM ai_usage WHERE user_id = ? AND day = ?", (user_id, day))
            + scalar("SELECT COUNT(*) FROM ai_reservations WHERE user_id = ? AND day = ?", (user_id, day)),
            "global_requests": scalar("SELECT COUNT(*) FROM ai_usage WHERE day = ?", (day,))
            + scalar("SELECT COUNT(*) FROM ai_reservations WHERE day = ?", (day,)),
            "user_in_flight": scalar("SELECT COUNT(*) FROM ai_reservations WHERE user_id = ?", (user_id,)),
        }

    def status(self, user_id: str) -> UsageStatus:
        try:
            with self.db.transaction() as conn:
                t = self._totals(conn, user_id, self._day())
        except sqlite3.Error:
            # Sin poder verificar, se informa que no queda nada (y `reserve` deniega).
            return UsageStatus(self.user_budget_usd, self.user_budget_usd, 0.0, self.user_daily_requests, self.user_daily_requests)
        remaining = min(self.user_budget_usd - t["user_spent"], self.budget_usd - t["global_spent"])
        return UsageStatus(
            user_budget_usd=self.user_budget_usd,
            user_spent_usd=round(min(t["user_spent"], self.user_budget_usd), 6),
            remaining_usd=round(max(0.0, remaining), 6),
            requests_today=int(t["user_requests"]),
            max_requests_per_day=self.user_daily_requests,
        )

    def global_spent_usd(self) -> float:
        try:
            return float(self.db.query("SELECT SUM(cost_usd) FROM ai_usage")[0][0] or 0)
        except sqlite3.Error:
            return math.inf

    def import_legacy_ledger(self, path: Path) -> int:
        """Importa UNA vez el registro JSON anterior (Fase 3B.2) para no perder el gasto ya hecho.

        Se registra a nombre de «historico». Si el archivo existe pero no se puede
        leer, no se arranca: el presupuesto no se podría verificar.
        """
        if not path.exists():
            return 0
        if self.db.query("SELECT 1 FROM meta WHERE key = 'legacy_ledger_imported'"):
            return 0
        try:
            records = json.loads(path.read_text(encoding="utf-8"))
            rows = [
                (
                    "historico",
                    datetime.fromisoformat(r["at"]).timestamp(),
                    r["at"][:10],
                    str(r.get("model", "desconocido")),
                    int(r.get("input_tokens", 0)),
                    int(r.get("output_tokens", 0)),
                    float(r["cost_usd"]),
                    int(bool(r.get("estimated", False))),
                )
                for r in records
            ]
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise ConfigurationError(
                f"No se pudo leer el registro de consumo anterior ({path.name}): revisalo o movelo antes de arrancar."
            ) from exc
        with self.db.transaction() as conn:
            conn.executemany(
                "INSERT INTO ai_usage (user_id, at, day, model, input_tokens, output_tokens, cost_usd, estimated) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
            conn.execute("INSERT INTO meta (key, value) VALUES ('legacy_ledger_imported', ?)", (path.name,))
        return len(rows)

    # --- Reserva y liquidación ---------------------------------------------------

    def _expire_stale(self, conn: sqlite3.Connection, now: float) -> None:
        """Una reserva abandonada se registra como consumo estimado por su máximo (conservador)."""
        for row in conn.execute("SELECT * FROM ai_reservations WHERE at < ?", (now - STALE_RESERVATION_SECONDS,)).fetchall():
            conn.execute(
                "INSERT INTO ai_usage (user_id, at, day, model, input_tokens, output_tokens, cost_usd, estimated) "
                "VALUES (?, ?, ?, 'desconocido', 0, 0, ?, 1)",
                (row["user_id"], row["at"], row["day"], row["amount_usd"]),
            )
            conn.execute("DELETE FROM ai_reservations WHERE id = ?", (row["id"],))

    def reserve(self, user_id: str, amount_usd: float) -> Reservation:
        now, day = self._clock(), self._day()
        try:
            with self.db.transaction() as conn:
                self._expire_stale(conn, now)
                t = self._totals(conn, user_id, day)
                if t["user_in_flight"] > 0:
                    raise AIGatewayError(409, "Ya tenés una consulta a la IA en curso. Esperá la respuesta. No se envió nada.")
                if t["user_requests"] >= self.user_daily_requests:
                    raise AIGatewayError(
                        429,
                        f"Alcanzaste el límite de {self.user_daily_requests} consultas a la IA por día. No se envió nada.",
                    )
                if t["global_requests"] >= self.global_daily_requests:
                    raise AIGatewayError(429, "Se alcanzó el límite diario de consultas a la IA del servicio. No se envió nada.")
                if t["user_spent"] + amount_usd > self.user_budget_usd:
                    left = max(0.0, self.user_budget_usd - t["user_spent"])
                    raise AIGatewayError(
                        402,
                        f"Presupuesto insuficiente en tu cuota: quedan USD {left:.4f} y esta solicitud podría costar "
                        f"hasta USD {amount_usd:.4f}. No se envió nada.",
                    )
                if t["global_spent"] + amount_usd > self.budget_usd:
                    raise AIGatewayError(
                        402, "Presupuesto global de la IA agotado: el servicio no acepta más consultas. No se envió nada."
                    )
                reservation = Reservation(secrets.token_hex(8), user_id, amount_usd)
                conn.execute(
                    "INSERT INTO ai_reservations (id, user_id, at, day, amount_usd) VALUES (?, ?, ?, ?, ?)",
                    (reservation.id, user_id, now, day, amount_usd),
                )
                return reservation
        except sqlite3.Error as exc:
            raise AIGatewayError(503, UNVERIFIABLE) from exc

    def settle(self, reservation: Reservation, *, model: str, input_tokens: int, output_tokens: int, cost: float, estimated: bool) -> None:
        """Cierra la reserva y registra el consumo (real, o estimado si el proveedor no lo informó).

        Si la base falla aquí, la reserva queda abierta y más tarde se cobra por su máximo.
        """
        with self.db.transaction() as conn:
            row = conn.execute("SELECT at, day FROM ai_reservations WHERE id = ?", (reservation.id,)).fetchone()
            if row is None:
                return  # ya se cobró como abandonada
            conn.execute("DELETE FROM ai_reservations WHERE id = ?", (reservation.id,))
            # También se registran los envíos sin costo: cuentan para el límite diario.
            conn.execute(
                "INSERT INTO ai_usage (user_id, at, day, model, input_tokens, output_tokens, cost_usd, estimated) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (reservation.user_id, self._clock(), row["day"], model, input_tokens, output_tokens, round(cost, 8), int(estimated)),
            )
