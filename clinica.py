"""Modelo sintético del edificio. Coordenadas en metros; tiempos en segundos."""

from copy import deepcopy
from math import isfinite
from pathlib import Path
import json
from pydantic import BaseModel, ConfigDict, Field

AREAS = [
    ["recepcion", "triaje", "atencion_prioritaria", "medicina_general", "pediatria"],
    ["ginecologia", "medicina_interna"],
    ["traumatologia", "cardiologia"],
    ["laboratorio", "imagenes"],
    ["observacion", "habitaciones"],
]


class ModeloNodo(BaseModel):
    """Nodo espacial de la clínica."""

    model_config = ConfigDict(extra="forbid", strict=True)
    piso: int
    x: float
    y: float
    tipo: str


class ModeloConexion(BaseModel):
    """Conexión del grafo con sus pesos y restricciones."""

    model_config = ConfigDict(extra="forbid", strict=True)
    origen: str
    destino: str
    tipo: str
    metros: float = Field(ge=0)
    segundos: float = Field(gt=0)
    accesible: bool
    bloqueada: bool
    grupo: str | None


class ModeloSeccion(BaseModel):
    """Sección y estado de atención de la clínica."""

    model_config = ConfigDict(extra="forbid", strict=True)
    id: str
    area: str
    piso: int
    estado: str
    espera_segundos: int = Field(ge=0)
    horario: str
    capacidad: int = Field(ge=0)


class ModeloClinica(BaseModel):
    """Estructura exterior de la clínica almacenada en datos."""

    model_config = ConfigDict(extra="forbid", strict=True)
    pisos: list[int]
    nodos: dict[str, ModeloNodo]
    conexiones: list[ModeloConexion]
    secciones: list[ModeloSeccion]


def secciones_disponibles(edificio, area):
    return deepcopy(
        [
            s
            for s in edificio["secciones"]
            if s["area"] == area and s["estado"] in ("abierta", "saturada")
        ]
    )


def conexiones_accesibles(edificio, silla_ruedas=False, bloqueados=()):
    return deepcopy(
        [
            e
            for e in edificio["conexiones"]
            if not e["bloqueada"]
            and e["grupo"] not in bloqueados
            and (not silla_ruedas or e["accesible"])
        ]
    )


def cargar_clinica():
    """Carga una copia independiente del edificio sintético validado."""
    ruta = Path(__file__).with_name("data") / "clinica.json"
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
        ModeloClinica.model_validate(datos)
    except (OSError, ValueError) as exc:
        raise ValueError(f"Clínica inválida: {ruta}: {exc}") from exc
    return datos


def validar_clinica(
    edificio,
    origen="recepcion_1",
    silla_ruedas=True,
    bloqueados=(),
    etapas=None,
    pisos_habilitados=None,
):
    errores = []
    nodos = edificio["nodos"]
    if edificio["pisos"] != [1, 2, 3, 4, 5]:
        errores.append("Se requieren cinco pisos")
    vecinos = {id: set() for id in nodos}
    pisos = set(edificio["pisos"] if pisos_habilitados is None else pisos_habilitados)
    if origen not in nodos or nodos[origen]["piso"] not in pisos:
        errores.append("Origen inexistente o fuera del nivel")
    for e in edificio["conexiones"]:
        a, b = e["origen"], e["destino"]
        if a not in nodos or b not in nodos:
            errores.append("Extremo inexistente")
            continue
        if not isfinite(e["segundos"]) or e["segundos"] <= 0:
            errores.append("Tiempo inválido")
        if (
            not e["bloqueada"]
            and e["grupo"] not in bloqueados
            and (not silla_ruedas or e["accesible"])
            and nodos[a]["piso"] in pisos
            and nodos[b]["piso"] in pisos
        ):
            vecinos[a].add(b)
            vecinos[b].add(a)
    vistos, pendientes = set(), [origen]
    while pendientes:
        u = pendientes.pop()
        if u in vistos:
            continue
        vistos.add(u)
        pendientes.extend(vecinos.get(u, set()) - vistos)
    for area in {s["area"] for s in edificio["secciones"]}:
        abiertas = [
            s for s in edificio["secciones"] if s["area"] == area and s["estado"] != "cerrada"
        ]
        if not abiertas:
            errores.append(f"{area}: sin sección abierta")
        if (etapas is None or area in etapas) and not any(s["id"] in vistos for s in abiertas):
            errores.append(f"{area}: sin acceso")
    for area in etapas or []:
        if not secciones_disponibles(edificio, area):
            errores.append(f"{area}: destino inexistente o cerrado")
    for s in edificio["secciones"]:
        if s["id"] not in nodos:
            errores.append("Sección sin nodo")
        if s["estado"] not in ("abierta", "cerrada", "saturada"):
            errores.append("Estado inválido")
    return errores
