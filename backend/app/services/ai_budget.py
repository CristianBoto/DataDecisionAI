"""Control local del consumo de la IA (Fase 3B.2).

- Estimación previa del costo máximo (entrada estimada + salida máxima).
- Reserva antes de enviar: si el presupuesto restante no alcanza, no se envía.
- Registro del consumo REAL informado por el proveedor (tokens y costo), en un
  archivo local sin contenido: ni objetivo, ni mensajes, ni nombres de columna.
- Límite de solicitudes por sesión del servidor (proceso actual).

No reemplaza los límites configurados en OpenAI Platform: son complementarios.
Las estimaciones pueden diferir del consumo real.
"""

from __future__ import annotations

import json
import math
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.services.ai_errors import AIGatewayError

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


def estimate_tokens(*texts: str) -> int:
    return math.ceil(sum(len(t) for t in texts) / CHARS_PER_TOKEN)


def model_prices(model: str, input_override: float | None, output_override: float | None) -> tuple[float, float] | None:
    if input_override is not None and output_override is not None:
        return input_override, output_override
    return MODEL_PRICES_PER_1M.get(model)


def cost_usd(prices: tuple[float, float], input_tokens: int, output_tokens: int) -> float:
    return (input_tokens * prices[0] + output_tokens * prices[1]) / 1_000_000


@dataclass
class Reservation:
    amount_usd: float


class AIBudget:
    """Presupuesto acumulado (persistente) y solicitudes de esta sesión (en memoria)."""

    def __init__(self, usage_file: str | Path, budget_usd: float, max_requests: int) -> None:
        self.usage_file = Path(usage_file)
        self.budget_usd = budget_usd
        self.max_requests = max_requests
        self.requests_used = 0
        self._reserved = 0.0
        self._lock = threading.Lock()
        self._spent: float | None = None

    @property
    def spent_usd(self) -> float:
        if self._spent is None:
            self._spent = self._load_spent()
        return self._spent

    @property
    def remaining_usd(self) -> float:
        return max(0.0, self.budget_usd - self.spent_usd - self._reserved)

    def _load_spent(self) -> float:
        try:
            records = json.loads(self.usage_file.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return 0.0
        except (OSError, ValueError):
            # Registro ilegible: se bloquea el consumo en lugar de asumir cero.
            return math.inf
        return float(sum(r.get("cost_usd", 0) for r in records))

    def reserve(self, amount_usd: float) -> Reservation:
        with self._lock:
            if self.requests_used >= self.max_requests:
                raise AIGatewayError(
                    429,
                    f"Se alcanzó el límite de {self.max_requests} solicitudes a la IA en esta sesión del servidor. "
                    "No se envió nada.",
                )
            if self.spent_usd + self._reserved + amount_usd > self.budget_usd:
                raise AIGatewayError(
                    402,
                    f"Presupuesto local insuficiente: quedan USD {self.remaining_usd:.4f} y esta solicitud podría costar "
                    f"hasta USD {amount_usd:.4f}. No se envió nada.",
                )
            self.requests_used += 1
            self._reserved += amount_usd
            return Reservation(amount_usd)

    def settle(self, reservation: Reservation, *, model: str, input_tokens: int, output_tokens: int, cost: float, estimated: bool) -> None:
        """Libera la reserva y registra el consumo (real, o estimado si el proveedor no lo informó)."""
        with self._lock:
            self._reserved = max(0.0, self._reserved - reservation.amount_usd)
            if cost <= 0 and input_tokens == 0 and output_tokens == 0:
                return
            record = {
                "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": round(cost, 8),
                "estimated": estimated,
            }
            try:
                records = json.loads(self.usage_file.read_text(encoding="utf-8"))
            except FileNotFoundError:
                records = []
            except (OSError, ValueError):
                # No se sobrescribe un registro ilegible; se bloquean nuevos envíos.
                self._spent = math.inf
                return
            records.append(record)
            self.usage_file.parent.mkdir(parents=True, exist_ok=True)
            self.usage_file.write_text(json.dumps(records, indent=2), encoding="utf-8")
            self._spent = self.spent_usd + cost
