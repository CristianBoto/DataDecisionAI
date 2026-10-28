"""Ejecución de planes aprobados con Pandas (Fase 4A). No consulta a ninguna IA.

El navegador vuelve a enviar los archivos originales SOLO cuando el usuario
pulsa «Ejecutar análisis» (el perfilado no los guardó). Se procesan en memoria
y se descartan al terminar el pedido. Requiere sesión: solo se ejecutan planes
del propio visitante.
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app.api.deps import ConcurrencyGate, require_user
from app.core.config import Settings, get_settings
from app.core.rate_limit import RateLimiter
from app.schemas.ai_plan import AIPlan
from app.schemas.analysis import ExecutionRequest
from app.services.ai_gateway import AIPlanStore
from app.services.analysis_engine import PlanError, execute_analysis
from app.services.auth import User
from app.services.dataset_profiler import DatasetProfileError
from app.services.report import ExecutionStore, descriptive_summary

router = APIRouter(prefix="/analysis", tags=["análisis"])

# Una ejecución a la vez: cada una puede leer hasta tres archivos en memoria. Además ocupa
# un lugar del cupo de tareas pesadas que comparte con el perfilado.
MAX_CONCURRENT_EXECUTIONS = 1
# Tiempo máximo de procesamiento (cooperativo: no empiezan operaciones nuevas después).
ANALYSIS_TIME_LIMIT_SECONDS = 90
# Suma de celdas de los archivos de una ejecución: el doble del máximo por archivo.
MAX_EXECUTION_CELLS_FACTOR = 2
EXECUTIONS_PER_10_MINUTES = 10


def get_ai_plans(request: Request) -> AIPlanStore:
    return request.app.state.ai_plans


def get_execution_gate(request: Request) -> ConcurrencyGate:
    return request.app.state.execution_gate


def get_executions(request: Request) -> ExecutionStore:
    return request.app.state.executions


def get_heavy_gate(request: Request) -> ConcurrencyGate:
    return request.app.state.heavy_gate


def get_limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


async def _read(upload: UploadFile, max_bytes: int) -> bytes:
    data = bytearray()
    while chunk := await upload.read(1024 * 1024):
        data.extend(chunk)
        if len(data) > max_bytes:
            raise HTTPException(status_code=413, detail=f"Un archivo supera los {max_bytes // (1024 * 1024)} MB.")
    return bytes(data)


def approved_plans(plan_ids: list[str], store: AIPlanStore, owner: str) -> list[tuple[str, AIPlan]]:
    """Los planes se toman del registro del backend (no del navegador), son del visitante y deben estar aprobados."""
    plans = []
    for plan_id in plan_ids:
        entry = store.get(plan_id, owner)
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
    user: User = Depends(require_user),
    settings: Settings = Depends(get_settings),
    gate: ConcurrencyGate = Depends(get_execution_gate),
    executions: ExecutionStore = Depends(get_executions),
    heavy: ConcurrencyGate = Depends(get_heavy_gate),
    limiter: RateLimiter = Depends(get_limiter),
) -> dict:
    """Ejecuta con Pandas las operaciones de los planes aprobados y devuelve los resultados.

    También devuelve el resumen descriptivo (sin IA) y un identificador para interpretar
    después ESTOS resultados: quedan en memoria, solo para este visitante.
    """
    uploads = {alias: f for alias, f in (("A", file_A), ("B", file_B), ("C", file_C)) if f is not None}
    try:
        try:
            parsed = ExecutionRequest.model_validate_json(request)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail="El pedido de ejecución no es válido.") from exc
        plans = approved_plans(parsed.plan_ids, store, user.id)
        if not limiter.hit(f"execute:{user.id}", EXECUTIONS_PER_10_MINUTES, 600):
            raise HTTPException(429, "Ejecutaste muchos análisis seguidos. Esperá unos minutos.", headers={"Retry-After": "600"})
        needed = {plan.source_alias for _, plan in plans}
        lacking = sorted(needed - set(uploads))
        if lacking:
            raise HTTPException(
                status_code=422,
                detail=f"Falta el archivo de la fuente {', '.join(lacking)}. Volvé a cargarlo para ejecutar el análisis.",
            )
        with heavy.slot(user.id), gate.slot(user.id):
            try:
                files = {
                    alias: (await _read(f, settings.max_upload_bytes), f.filename or "")
                    for alias, f in uploads.items()
                    if alias in needed
                }
                # Pandas es síncrono: se ejecuta en un hilo para no bloquear el servidor.
                result = await run_in_threadpool(
                    execute_analysis,
                    parsed,
                    plans,
                    files,
                    max_bytes=settings.max_upload_bytes,
                    max_cells=settings.max_dataset_cells,
                    max_total_cells=MAX_EXECUTION_CELLS_FACTOR * settings.max_dataset_cells,
                    time_limit_seconds=ANALYSIS_TIME_LIMIT_SECONDS,
                )
            except (DatasetProfileError, PlanError) as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        summary = descriptive_summary(result)
        result["summary"] = summary
        result["execution_id"] = executions.save(result, summary, parsed.objective, user.id)
        return result
    finally:
        for upload in uploads.values():
            await upload.close()
