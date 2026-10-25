"""Ejecución de planes aprobados con Pandas (Fase 4A). No consulta a ninguna IA.

El navegador vuelve a enviar los archivos originales SOLO cuando el usuario
pulsa «Ejecutar análisis» (el perfilado no los guardó). Se procesan en memoria
y se descartan al terminar el pedido.
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app.schemas.ai_plan import AIPlan
from app.schemas.analysis import ExecutionRequest
from app.services.ai_gateway import AIPlanStore
from app.services.analysis_engine import PlanError, execute_analysis
from app.services.dataset_profiler import MAX_FILE_BYTES, DatasetProfileError

router = APIRouter(prefix="/analysis", tags=["análisis"])

# Una ejecución a la vez: cada una puede leer hasta tres archivos en memoria.
MAX_CONCURRENT_EXECUTIONS = 1
_active = 0


def get_ai_plans(request: Request) -> AIPlanStore:
    return request.app.state.ai_plans


async def _read(upload: UploadFile) -> bytes:
    data = bytearray()
    while chunk := await upload.read(1024 * 1024):
        data.extend(chunk)
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail="Un archivo supera los 25 MB.")
    return bytes(data)


def approved_plans(plan_ids: list[str], store: AIPlanStore) -> list[tuple[str, AIPlan]]:
    """Los planes se toman del registro del backend (no del navegador) y deben estar aprobados."""
    plans = []
    for plan_id in plan_ids:
        entry = store.get(plan_id)
        if entry is None:
            raise HTTPException(
                status_code=404,
                detail="Un plan ya no está disponible (por ejemplo, se reinició el backend). Pedí la propuesta de nuevo y aprobala.",
            )
        if entry["status"] != "approved":
            raise HTTPException(status_code=409, detail=f"El plan «{entry['plan'].title}» no está aprobado: no se ejecuta.")
        plans.append((plan_id, entry["plan"]))
    return plans


@router.post("/execute")
async def execute(
    request: str = Form(..., max_length=200_000),
    file_A: UploadFile | None = File(None),
    file_B: UploadFile | None = File(None),
    file_C: UploadFile | None = File(None),
    store: AIPlanStore = Depends(get_ai_plans),
) -> dict:
    """Ejecuta con Pandas las operaciones de los planes aprobados y devuelve los resultados."""
    global _active
    uploads = {alias: f for alias, f in (("A", file_A), ("B", file_B), ("C", file_C)) if f is not None}
    try:
        try:
            parsed = ExecutionRequest.model_validate_json(request)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail="El pedido de ejecución no es válido.") from exc
        plans = approved_plans(parsed.plan_ids, store)
        needed = {plan.source_alias for _, plan in plans}
        lacking = sorted(needed - set(uploads))
        if lacking:
            raise HTTPException(
                status_code=422,
                detail=f"Falta el archivo de la fuente {', '.join(lacking)}. Volvé a cargarlo para ejecutar el análisis.",
            )
        if _active >= MAX_CONCURRENT_EXECUTIONS:
            raise HTTPException(status_code=429, detail="Ya hay un análisis en ejecución. Intentá de nuevo en unos segundos.")
        _active += 1
        try:
            files = {alias: (await _read(f), f.filename or "") for alias, f in uploads.items() if alias in needed}
            # Pandas es síncrono: se ejecuta en un hilo para no bloquear el servidor.
            return await run_in_threadpool(execute_analysis, parsed, plans, files)
        except (DatasetProfileError, PlanError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        finally:
            _active -= 1
    finally:
        for upload in uploads.values():
            await upload.close()
