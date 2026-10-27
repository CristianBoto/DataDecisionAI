"""Persistencia mínima en SQLite (biblioteca estándar): invitaciones, sesiones y consumo de la IA.

Qué se guarda y qué no:
- Invitaciones y sesiones: solo la HUELLA SHA-256 de cada código o token (nunca
  el valor), etiqueta, vencimiento y revocación.
- Consumo de la IA: fecha, visitante, modelo, tokens y costo. Sin objetivo,
  mensajes, columnas ni datos.
- Nunca se guardan los datasets ni el contenido de las conversaciones.

Una sola conexión protegida por un lock (una instancia del backend). Las
operaciones de presupuesto usan `BEGIN IMMEDIATE`, que también serializa a
otros procesos que abran el mismo archivo.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    revoked_at REAL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES invitations(id),
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    revoked_at REAL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    at REAL NOT NULL,
    day TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL,
    estimated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_usage_user_day ON ai_usage(user_id, day);
CREATE INDEX IF NOT EXISTS ai_usage_day ON ai_usage(day);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_reservations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    at REAL NOT NULL,
    day TEXT NOT NULL,
    amount_usd REAL NOT NULL
);
"""


class Database:
    def __init__(self, path: str | Path, *, create_dir: bool = True) -> None:
        self.path = Path(path)
        if create_dir:  # en producción la carpeta debe ser el disco persistente ya montado
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        # isolation_level=None: las transacciones se abren explícitamente.
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None, timeout=10)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.executescript(SCHEMA)

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Transacción exclusiva para escritura: o se aplica todo, o nada."""
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield self._conn
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise
            self._conn.execute("COMMIT")

    def query(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, params).fetchall()

    def close(self) -> None:
        with self._lock:
            self._conn.close()
