"""Endpoint local de diagnóstico de datos (sin almacenamiento permanente)."""

from fastapi import APIRouter, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.services.dataset_profiler import (
    MAX_FILE_BYTES,
    DatasetProfileError,
    profile_dataset,
)

router = APIRouter(prefix="/datasets", tags=["datasets"])

# Perfilados simultáneos permitidos: acota la memoria (cada uno puede usar
# cientos de MB). El frontend envía los archivos de a uno, así que un usuario
# local no debería alcanzarlo. No es una cola: el exceso se rechaza con 429.
MAX_CONCURRENT_PROFILES = 2
_active_profiles = 0


@router.post("/profile")
async def profile_uploaded_dataset(file: UploadFile = File(...)) -> dict:
    """Devuelve un perfil del archivo; no persiste su contenido."""
    global _active_profiles
    if _active_profiles >= MAX_CONCURRENT_PROFILES:
        await file.close()
        raise HTTPException(
            status_code=429,
            detail="El servidor está procesando otros archivos. Intentá de nuevo en unos segundos.",
        )
    # Sin `await` entre la verificación y el incremento: no hay carreras en el bucle de eventos.
    _active_profiles += 1
    try:
        # Leer en fragmentos evita consumir memoria sin límite.
        data = bytearray()
        while chunk := await file.read(1024 * 1024):
            data.extend(chunk)
            if len(data) > MAX_FILE_BYTES:
                raise HTTPException(status_code=413, detail="El archivo supera los 25 MB.")

        try:
            # Pandas es síncrono: se ejecuta en un hilo para no bloquear el bucle de eventos.
            return await run_in_threadpool(profile_dataset, bytes(data), file.filename or "")
        except DatasetProfileError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        _active_profiles -= 1
        await file.close()
