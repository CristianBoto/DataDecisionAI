"""Endpoint de diagnóstico de datos (sin almacenamiento permanente). Requiere sesión."""

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.api.deps import ConcurrencyGate, require_user
from app.core.config import Settings, get_settings
from app.core.rate_limit import RateLimiter
from app.services.auth import User
from app.services.dataset_profiler import DatasetProfileError, profile_dataset

router = APIRouter(prefix="/datasets", tags=["datasets"])

# Tareas pesadas (perfilados y ejecuciones) comparten un cupo: `Settings.heavy_tasks_limit` en total
# (1 en producción) y una por visitante. El frontend envía los archivos de a uno. No es una cola:
# el exceso se rechaza al instante con 429 y Retry-After.
MAX_PROFILES_PER_USER = 1
# Frecuencia por visitante (además del límite por IP): una invitación no acapara el servidor.
PROFILES_PER_10_MINUTES = 30


def get_profile_gate(request: Request) -> ConcurrencyGate:
    return request.app.state.heavy_gate


def get_limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


@router.post("/profile")
async def profile_uploaded_dataset(
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    settings: Settings = Depends(get_settings),
    gate: ConcurrencyGate = Depends(get_profile_gate),
    limiter: RateLimiter = Depends(get_limiter),
) -> dict:
    """Devuelve un perfil del archivo; no persiste su contenido."""
    try:
        if not limiter.hit(f"profile:{user.id}", PROFILES_PER_10_MINUTES, 600):
            raise HTTPException(429, "Cargaste muchos archivos seguidos. Esperá unos minutos.", headers={"Retry-After": "600"})
        with gate.slot(user.id):
            # Leer en fragmentos evita consumir memoria sin límite.
            data = bytearray()
            while chunk := await file.read(1024 * 1024):
                data.extend(chunk)
                if len(data) > settings.max_upload_bytes:
                    raise HTTPException(status_code=413, detail=f"El archivo supera los {settings.max_upload_mb} MB.")
            try:
                # Pandas es síncrono: se ejecuta en un hilo para no bloquear el bucle de eventos.
                return await run_in_threadpool(
                    profile_dataset,
                    bytes(data),
                    file.filename or "",
                    max_bytes=settings.max_upload_bytes,
                    max_cells=settings.max_dataset_cells,
                )
            except DatasetProfileError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await file.close()
