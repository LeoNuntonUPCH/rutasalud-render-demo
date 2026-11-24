"""Rutas de catálogo y escenarios."""

from fastapi import APIRouter
from servicios.rondas import ServicioRondas


def crear_router(servicio: ServicioRondas) -> APIRouter:
    """Conecta los endpoints de casos al servicio."""
    router = APIRouter()

    @router.get("/juego/casos")
    async def catalogo():
        return servicio.catalogo()

    @router.get("/juego/escenarios/{id}/plano")
    async def plano(id: str):
        return servicio.plano(id)

    @router.get("/escenarios/{id}")
    async def escenario(id: str):
        return servicio.escenario(id)

    return router
