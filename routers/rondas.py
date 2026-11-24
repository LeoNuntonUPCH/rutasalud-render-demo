"""Rutas de creación y avance de rondas."""

from fastapi import APIRouter
from servicios.rondas import ServicioRondas


def crear_router(servicio: ServicioRondas, Inicio: type, Eleccion: type) -> APIRouter:
    """Conecta las operaciones de ronda al servicio."""
    router = APIRouter()

    @router.post("/rondas")
    async def iniciar(datos: Inicio):
        return servicio.iniciar(datos)

    @router.get("/rondas/{id}")
    async def consultar(id: str):
        return servicio.consultar(id)

    @router.post("/rondas/{id}/eleccion")
    async def elegir(id: str, datos: Eleccion):
        return servicio.elegir(id, datos)

    @router.post("/rondas/{id}/avance")
    async def avanzar(id: str):
        return servicio.avanzar(id)

    return router
