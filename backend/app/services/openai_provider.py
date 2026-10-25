"""Proveedor OpenAI (Fase 3B.2): Responses API con salida estructurada.

- Solo se invoca desde `authorize_and_send`, después de la autorización de uso
  único y de reservar presupuesto.
- Sin reintentos automáticos (`max_retries=0`): un reintento podría cobrar dos veces.
- `store=False`: se pide al proveedor no conservar la respuesta para reutilizarla.
- Los errores se traducen a mensajes comprensibles, sin la clave ni el contenido.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from app.core.config import Settings
from app.schemas.ai_context import AIContext
from app.schemas.ai_plan import AIAssistantReply
from app.services.ai_errors import AIGatewayError

INSTRUCTIONS = """\
Sos el asistente de requisitos de DataDecision AI. Ayudás a una persona a definir qué analizar en sus datos.
No calculás nada: Python/Pandas ejecutará más adelante los cálculos que la persona apruebe.

Recibís un JSON con:
- objective: lo que la persona necesita analizar; message: su mensaje actual (si falta, respondé al objetivo).
- sources: fuentes con alias A, B o C. De cada columna conocés solo su nombre, formato, tipo semántico,
  confianza, si la persona corrigió la interpretación (user_corrected) y su decisión sobre marcadores de
  ausencia como "NA" (missing_markers: pending = sin decidir).
- history: turnos anteriores de esta conversación.
No conocés valores, filas ni el nombre de los archivos. Nunca inventes valores, cantidades ni resultados.

Reglas:
1. Usá solo los alias y nombres de columna recibidos, escritos exactamente igual.
2. Respetá el tipo semántico. Si user_corrected es true, es una decisión de la persona: no la cambies.
   Una columna "identifier" (código) no se suma ni se promedia aunque sea numérica: se cuenta o se agrupa.
3. Cada plan usa UNA sola fuente. Si la persona pide analizar fuentes por separado o sin unirlas, proponé
   planes independientes (source_relationship = "independent") y no sugieras unirlas.
4. Si falta información o hay ambigüedad (por ejemplo, marcadores con missing_markers = "pending" en
   columnas que el análisis usaría), formulá preguntas breves en questions.
5. Operaciones: solo las del catálogo del esquema. Gráficos: solo los tipos del esquema.
6. Explicá en rationale, en una o dos oraciones, por qué proponés cada análisis.
7. En warnings y limitations reconocé incertidumbres. No escribas código ni instrucciones para ejecutar.
8. Respondé en español rioplatense, claro y breve. message: 1 a 3 oraciones dirigidas a la persona.
"""


@dataclass
class ProviderResult:
    reply: AIAssistantReply | None
    input_tokens: int
    output_tokens: int
    # Motivo por el que no hay respuesta utilizable (incompleta, rechazada, sin formato).
    problem: str | None = None


class ProviderCallError(AIGatewayError):
    """Error del proveedor. `may_have_cost` indica si la solicitud pudo haberse cobrado."""

    def __init__(self, status_code: int, detail: str, *, may_have_cost: bool) -> None:
        super().__init__(status_code, detail)
        self.may_have_cost = may_have_cost


def build_input(context: AIContext) -> str:
    return json.dumps(context.model_dump(mode="json"), ensure_ascii=False)


class OpenAIProvider:
    implemented = True

    def __init__(self, client_factory=None) -> None:
        # Se inyecta en las pruebas; por defecto, el SDK oficial.
        self._client_factory = client_factory or _default_client

    def send(self, context: AIContext, settings: Settings) -> ProviderResult:
        import openai

        client = self._client_factory(settings)
        try:
            response = client.responses.parse(
                model=settings.openai_model,
                instructions=INSTRUCTIONS,
                input=build_input(context),
                text_format=AIAssistantReply,
                max_output_tokens=settings.ai_max_output_tokens,
                reasoning={"effort": settings.openai_reasoning_effort},
                store=False,
            )
        except openai.APITimeoutError as exc:
            raise ProviderCallError(
                504, "OpenAI no respondió a tiempo. No se reintentó automáticamente.", may_have_cost=True
            ) from exc
        except openai.APIConnectionError as exc:
            raise ProviderCallError(
                502, "No se pudo conectar con OpenAI. Revisá la conexión a internet.", may_have_cost=False
            ) from exc
        except openai.AuthenticationError as exc:
            raise ProviderCallError(
                502, "OpenAI rechazó las credenciales. Revisá OPENAI_API_KEY en backend/.env.", may_have_cost=False
            ) from exc
        except openai.PermissionDeniedError as exc:
            raise ProviderCallError(502, "La cuenta de OpenAI no tiene permiso para usar este modelo.", may_have_cost=False) from exc
        except openai.NotFoundError as exc:
            raise ProviderCallError(
                502, f"OpenAI no encontró el modelo «{settings.openai_model}». Revisá OPENAI_MODEL.", may_have_cost=False
            ) from exc
        except openai.RateLimitError as exc:
            code = getattr(exc, "code", None)
            detail = (
                "La cuenta de OpenAI no tiene saldo o cuota disponible."
                if code == "insufficient_quota"
                else "OpenAI limitó temporalmente las solicitudes. Esperá un momento antes de volver a intentar."
            )
            raise ProviderCallError(429, detail, may_have_cost=False) from exc
        except openai.BadRequestError as exc:
            raise ProviderCallError(502, "OpenAI rechazó la solicitud por un problema de formato.", may_have_cost=False) from exc
        except openai.APIStatusError as exc:
            raise ProviderCallError(502, f"OpenAI devolvió un error ({exc.status_code}).", may_have_cost=True) from exc
        except (openai.OpenAIError, ValueError) as exc:
            # ValueError incluye la validación de Pydantic sobre una salida malformada.
            raise ProviderCallError(502, "La respuesta de OpenAI no tenía el formato esperado.", may_have_cost=True) from exc

        usage = getattr(response, "usage", None)
        input_tokens = getattr(usage, "input_tokens", 0) or 0
        output_tokens = getattr(usage, "output_tokens", 0) or 0
        if response.status == "incomplete":
            reason = getattr(response.incomplete_details, "reason", None)
            problem = (
                "La respuesta superó el límite de tokens de salida y quedó incompleta."
                if reason == "max_output_tokens"
                else "La respuesta de la IA quedó incompleta."
            )
            return ProviderResult(None, input_tokens, output_tokens, problem)
        if _refusal(response):
            return ProviderResult(None, input_tokens, output_tokens, "La IA no aceptó responder esta solicitud.")
        parsed = getattr(response, "output_parsed", None)
        if parsed is None:
            return ProviderResult(None, input_tokens, output_tokens, "La respuesta de la IA no tenía el formato esperado.")
        return ProviderResult(parsed, input_tokens, output_tokens)


def _refusal(response) -> bool:
    for item in getattr(response, "output", None) or []:
        for content in getattr(item, "content", None) or []:
            if getattr(content, "type", None) == "refusal":
                return True
    return False


def _default_client(settings: Settings):
    from openai import OpenAI

    return OpenAI(api_key=settings.openai_api_key, timeout=settings.ai_timeout_seconds, max_retries=0)
