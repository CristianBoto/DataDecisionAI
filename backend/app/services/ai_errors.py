"""Error común de la frontera de IA: código HTTP y mensaje comprensible, sin datos sensibles."""


class AIGatewayError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
