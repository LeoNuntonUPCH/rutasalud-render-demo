"""API local de escenarios y rondas del prototipo."""

import json
import os
from pathlib import Path
from copy import deepcopy
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from escenarios import cargar_escenarios
from calibracion import calibrar_escenarios
from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError
from routers import (
    casos as rutas_casos,
    editor as rutas_editor,
    evaluacion as rutas_evaluacion,
    rondas as rutas_rondas,
)
from servicios.almacen import EnMemoria, SQLite
from servicios.rondas import ServicioRondas

CARPETA_CALIBRACION = Path(__file__).with_name("data") / "calibracion"


class FichaCaso(BaseModel):
    """Datos de presentación y pista de un caso."""

    model_config = ConfigDict(extra="forbid", strict=True)
    id: str
    titulo: str
    area_destino: str
    pista: str


class ResultadoCalibracion(BaseModel):
    """Resultado de búsqueda guardado en una consulta calibrada."""

    model_config = ConfigDict(extra="forbid", strict=True)
    ruta: list[str] | None
    costo: int | float | None
    expansiones: int


class ConsultaCalibracion(BaseModel):
    """Estructura de una consulta de calibración vigente."""

    model_config = ConfigDict(extra="forbid", strict=True)
    caso: str
    version: int
    estado: str
    origen: str
    area: str
    garantizados: list[str]
    habilitados: list[str]
    destinos: list[str]
    unidad: str
    optimo: int | float
    presupuesto: int
    errores_heuristica: list
    resultados: dict[str, ResultadoCalibracion]


def cargar_fichas(ruta: Path | None = None) -> dict[str, FichaCaso]:
    """Carga y valida las fichas sin limitar la cantidad de casos."""
    ruta = ruta or Path(__file__).with_name("data") / "casos.json"
    fichas = TypeAdapter(list[FichaCaso]).validate_json(ruta.read_bytes())
    if len({ficha.id for ficha in fichas}) != len(fichas):
        raise ValueError("Hay identificadores de fichas duplicados")
    return {ficha.id: ficha for ficha in fichas}


def cargar_calibracion(ruta: Path | None = None) -> list[dict]:
    """Carga la calibración requerida y rechaza archivos ausentes o inválidos."""
    try:
        if ruta is None:
            archivos = sorted(CARPETA_CALIBRACION.glob("*.json"))
            if not archivos:
                raise ValueError("no existen archivos de calibración")
            filas = []
            for archivo in archivos:
                parte = json.loads(archivo.read_text(encoding="utf-8"))
                if not isinstance(parte, list) or not parte:
                    raise ValueError(f"archivo vacío o inválido: {archivo}")
                TypeAdapter(list[ConsultaCalibracion]).validate_python(parte)
                if any(fila["caso"] != archivo.stem for fila in parte):
                    raise ValueError(f"identificador incompatible: {archivo}")
                filas.extend(parte)
        else:
            filas = json.loads(ruta.read_text(encoding="utf-8"))
        if not filas:
            raise ValueError("la calibración está vacía")
        TypeAdapter(list[ConsultaCalibracion]).validate_python(filas)
    except (OSError, ValueError, ValidationError) as exc:
        ubicacion = ruta if ruta is not None else CARPETA_CALIBRACION
        raise RuntimeError(f"No se pudo cargar la calibración vigente: {ubicacion}: {exc}") from exc
    return filas


class Inicio(BaseModel):
    model_config = ConfigDict(extra="forbid")
    escenario: str


class Eleccion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    algoritmo: str


def crear_app(calibracion=None, escenarios=None):
    """Construye la aplicación conservando sus parámetros públicos."""
    app = FastAPI(title="RutaSalud", version="0.9.0")
    casos = {
        c["id"]: c for c in deepcopy(escenarios if escenarios is not None else cargar_escenarios())
    }
    desde_archivo = calibracion is None
    if desde_archivo:
        calibracion = cargar_calibracion()
    filas = deepcopy(calibracion)
    referencia = calibrar_escenarios()
    if desde_archivo:
        campos = ("caso", "estado", "origen", "area")
        claves = [tuple(fila[campo] for campo in campos) for fila in filas]
        esperadas = [tuple(fila[campo] for campo in campos) for fila in referencia]
        if len(claves) != len(set(claves)) or set(claves) != set(esperadas):
            raise RuntimeError(
                "No se pudo cargar la calibración vigente: consultas incompletas o duplicadas"
            )
    ruta_sqlite = os.environ.get("RUTASALUD_SQLITE")
    repositorio = SQLite(ruta_sqlite) if ruta_sqlite else EnMemoria()
    servicio = ServicioRondas(casos, filas, referencia, cargar_fichas(), repositorio)

    @app.get("/")
    async def interfaz():
        return FileResponse(Path(__file__).with_name("web").joinpath("index.html"))

    app.mount("/web", StaticFiles(directory=Path(__file__).with_name("web")), name="web")
    app.include_router(rutas_casos.crear_router(servicio))
    app.include_router(rutas_rondas.crear_router(servicio, Inicio, Eleccion))
    app.include_router(rutas_evaluacion.crear_router(servicio))
    app.include_router(rutas_editor.crear_router())
    return app


app = crear_app()
