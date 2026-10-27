"""Endpoint de diagnóstico de datos (sin almacenamiento permanente). Requiere sesión."""

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.api.deps import ConcurrencyGate, require_user
from app.core.config import Settings, get_settings
from app.services.auth import User
from app.services.dataset_profiler import DatasetProfileError, profile_dataset

router = APIRouter(prefix="/datasets", tags=["datasets"])

# Perfilados simultáneos: acota la memoria (cada uno puede usar cientos de MB).
# El frontend envía los archivos de a uno. No es una cola: el exceso se rechaza con 429.
MAX_CONCURRENT_PROFILES = 2
MAX_PROFILES_PER_USER = 1


def get_profile_gate(request: Request) -> ConcurrencyGate:
    return request.app.state.profile_gate


@router.post("/profile")
async def profile_uploaded_dataset(
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    settings: Settings = Depends(get_settings),
    gate: ConcurrencyGate = Depends(get_profile_gate),
) -> dict:
    """Devuelve un perfil del archivo; no persiste su contenido."""
    try:
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
