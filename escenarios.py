"""Estados reproducibles de Fase 2; el balance algorítmico pertenece a Fase 3."""

from clinica import cargar_clinica, validar_clinica
from pathlib import Path
import json
from pydantic import BaseModel, ConfigDict, Field

CARPETA_ESCENARIOS = Path(__file__).with_name("data") / "escenarios"


class CambioConexion(BaseModel):
    """Modificación de una conexión del edificio base."""

    model_config = ConfigDict(extra="forbid", strict=True)
    indice: int = Field(ge=0)
    cambios: dict


class CambioSeccion(BaseModel):
    """Modificación de una sección del edificio base."""

    model_config = ConfigDict(extra="forbid", strict=True)
    id: str
    cambios: dict


class ModeloEscenario(BaseModel):
    """Esquema de escenario independiente del edificio base."""

    model_config = ConfigDict(extra="forbid", strict=True)
    id: str
    nivel: int
    origen: str
    silla_ruedas: bool
    pisos_habilitados: list[int]
    etapas: list[str]
    eventos: list[dict]
    costo: str
    semilla: int
    hora_caso: str
    bloqueados_iniciales: list[str]
    heuristica_disponible: bool
    cambios_conexiones: list[CambioConexion]
    cambios_secciones: list[CambioSeccion]


def cargar_escenarios():
    """Carga escenarios de datos, aplicando cambios a una clínica independiente."""
    carpeta = CARPETA_ESCENARIOS
    casos = []
    for ruta in sorted(carpeta.glob("*.json")):
        try:
            datos = json.loads(ruta.read_text(encoding="utf-8"))
            ModeloEscenario.model_validate(datos)
            cambios_conexiones = datos.pop("cambios_conexiones")
            cambios_secciones = datos.pop("cambios_secciones")
            edificio = cargar_clinica()
            for cambio in cambios_conexiones:
                edificio["conexiones"][cambio["indice"]].update(cambio["cambios"])
            secciones = {s["id"]: s for s in edificio["secciones"]}
            for cambio in cambios_secciones:
                secciones[cambio["id"]].update(cambio["cambios"])
            # Se conserva el orden público original de los campos.
            caso = {
                "id": datos.pop("id"),
                "nivel": datos.pop("nivel"),
                "edificio": edificio,
                **datos,
            }
            casos.append(caso)
        except (OSError, ValueError, KeyError, IndexError) as exc:
            raise ValueError(f"Escenario inválido: {ruta}: {exc}") from exc
    return casos


def validar_escenario(caso):
    args = dict(silla_ruedas=caso["silla_ruedas"], pisos_habilitados=caso["pisos_habilitados"])
    errores = validar_clinica(
        caso["edificio"],
        origen=caso["origen"],
        etapas=caso["etapas"],
        bloqueados=caso["bloqueados_iniciales"],
        **args,
    )
    for s in caso["edificio"]["secciones"]:
        apertura, cierre = s["horario"].split("–")
        if not (apertura <= caso["hora_caso"] < cierre) and s["estado"] != "cerrada":
            errores.append(f"{s['id']}: abierta fuera de horario")
        if (
            s["estado"] == "cerrada"
            and s.get("motivo_cierre") == "Fuera de horario"
            and apertura <= caso["hora_caso"] < cierre
        ):
            errores.append(f"{s['id']}: cierre horario contradictorio")
    for evento in caso["eventos"]:
        errores.extend(validar_clinica(caso["edificio"], **evento, **args))
    return errores
