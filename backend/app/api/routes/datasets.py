"""Endpoint local de diagnóstico de datos (sin almacenamiento permanente)."""

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.services.dataset_profiler import (
    MAX_FILE_BYTES,
    DatasetProfileError,
    profile_dataset,
)

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.post("/profile")
async def profile_uploaded_dataset(file: UploadFile = File(...)) -> dict:
    """Devuelve un perfil del archivo; no persiste su contenido."""
    try:
        # Leer en fragmentos evita consumir memoria sin límite.
        data = bytearray()
        while chunk := await file.read(1024 * 1024):
            data.extend(chunk)
            if len(data) > MAX_FILE_BYTES:
                raise HTTPException(status_code=413, detail="El archivo supera los 25 MB.")

        try:
            return profile_dataset(bytes(data), file.filename or "")
        except DatasetProfileError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await file.close()
