"""Ruta de evaluación de rondas."""

from fastapi import APIRouter
from servicios.rondas import ServicioRondas


def crear_router(servicio: ServicioRondas) -> APIRouter:
    """Conecta el endpoint de evaluación al servicio."""
    router = APIRouter()

    @router.get("/rondas/{id}/evaluacion")
    async def evaluar(id: str):
        return servicio.evaluar(id)

    return router
