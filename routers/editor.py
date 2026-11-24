"""Rutas del editor de escenarios (P7c)."""

from pathlib import Path
from typing import Any
from fastapi import APIRouter
from fastapi.responses import FileResponse
from servicios.editor import obtener_esquema_editor, validar_borrador_escenario


def crear_router() -> APIRouter:
    """Expone la vista y endpoints de esquema y validación del editor."""
    router = APIRouter()
    web_dir = Path(__file__).resolve().parents[1] / "web"

    @router.get("/editor")
    async def vista_editor():
        return FileResponse(web_dir / "editor.html")

    @router.get("/editor/esquema")
    async def esquema_editor() -> dict:
        return obtener_esquema_editor()

    @router.post("/editor/validar")
    async def validar_editor(datos: dict[str, Any]) -> dict:
        return validar_borrador_escenario(datos)

    return router
