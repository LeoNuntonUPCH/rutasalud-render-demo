"""Servicio de esquema y validación de escenarios para el editor P7c."""

import re
import logging
import math
import sys
from pydantic import ValidationError
from clinica import AREAS, cargar_clinica
from escenarios import ModeloEscenario, validar_escenario

PATRON_HORA = re.compile(r"^\d{2}:\d{2}$")
COSTOS_VALIDOS = ("tramos", "segundos")
LOGGER = logging.getLogger(__name__)

TIPOS_SECCION = {
    "id": (str,),
    "area": (str,),
    "piso": (int,),
    "estado": (str,),
    "espera_segundos": (int,),
    "horario": (str,),
    "capacidad": (int,),
    "motivo_cierre": (str,),
}
TIPOS_CONEXION = {
    "origen": (str,),
    "destino": (str,),
    "tipo": (str,),
    "metros": (int, float),
    "segundos": (int, float),
    "accesible": (bool,),
    "bloqueada": (bool,),
    "grupo": (str, type(None)),
}


def _validar_cambios(cambios: dict, tipos: dict, contexto: str) -> list[str]:
    """Rechaza claves y valores incompatibles con la estructura de la clínica."""
    errores = []
    for clave, valor in cambios.items():
        if clave not in tipos:
            errores.append(f"{contexto}.{clave}: campo desconocido")
        elif type(valor) not in tipos[clave]:
            errores.append(f"{contexto}.{clave}: tipo inválido")
        elif clave in ("metros", "segundos") and (
            valor > sys.float_info.max
            or (type(valor) is float and not math.isfinite(valor))
            or valor < 0
            or (clave == "segundos" and valor == 0)
        ):
            errores.append(f"{contexto}.{clave}: debe ser un número finito válido")
        elif clave in ("espera_segundos", "capacidad") and valor < 0:
            errores.append(f"{contexto}.{clave}: no puede ser negativo")
    return errores


def _hora_valida(hora: str) -> bool:
    """Comprueba formato y rango de una hora de 24 horas."""
    return bool(PATRON_HORA.fullmatch(hora)) and int(hora[:2]) < 24 and int(hora[3:]) < 60


def obtener_esquema_editor() -> dict:
    """Devuelve catálogo de nodos, áreas, secciones y conexiones del edificio base."""
    edificio = cargar_clinica()
    areas = [{"area": area, "piso": piso} for piso, lista in enumerate(AREAS, 1) for area in lista]
    conexiones_verticales = [
        {
            "indice": idx,
            "origen": e["origen"],
            "destino": e["destino"],
            "grupo": e["grupo"],
            "segundos": e["segundos"],
        }
        for idx, e in enumerate(edificio["conexiones"])
        if e.get("grupo") in ("ascensor_a", "ascensor_b", "escalera")
    ]
    secciones = [
        {
            "id": s["id"],
            "area": s["area"],
            "piso": s["piso"],
            "horario": s["horario"],
        }
        for s in edificio["secciones"]
    ]
    return {
        "pisos": edificio["pisos"],
        "areas": areas,
        "secciones": secciones,
        "grupos_bloqueables": ["ascensor_a", "ascensor_b", "escalera"],
        "conexiones_verticales": conexiones_verticales,
        "costos_validos": list(COSTOS_VALIDOS),
    }


def _construir_caso(modelo: ModeloEscenario) -> tuple[dict | None, list[str]]:
    """Aplica cambios al edificio base y verifica índices, horarios e IDs."""
    errores: list[str] = []
    datos = modelo.model_dump()
    if not datos["id"].strip():
        errores.append("id: no puede estar vacío")
    if not (1 <= datos["nivel"] <= 4):
        errores.append("nivel: debe estar entre 1 y 4")
    if datos["costo"] not in COSTOS_VALIDOS:
        errores.append("costo: debe ser 'tramos' o 'segundos'")
    if not _hora_valida(datos["hora_caso"]):
        errores.append("hora_caso: debe tener formato HH:MM")
    if not datos["etapas"]:
        errores.append("etapas: debe incluir al menos un área destino")
    if not datos["pisos_habilitados"]:
        errores.append("pisos_habilitados: debe habilitar al menos un piso")
    elif any(p not in (1, 2, 3, 4, 5) for p in datos["pisos_habilitados"]):
        errores.append("pisos_habilitados: solo se permiten pisos del 1 al 5")

    edificio = cargar_clinica()
    total_conexiones = len(edificio["conexiones"])
    for cambio in datos["cambios_conexiones"]:
        idx = cambio["indice"]
        if idx < 0 or idx >= total_conexiones:
            errores.append(f"cambios_conexiones[{idx}]: índice fuera de rango")
            continue
        errores_cambio = _validar_cambios(cambio["cambios"], TIPOS_CONEXION, f"conexión {idx}")
        errores.extend(errores_cambio)
        if not errores_cambio:
            edificio["conexiones"][idx].update(cambio["cambios"])

    secciones = {s["id"]: s for s in edificio["secciones"]}
    for cambio in datos["cambios_secciones"]:
        sec_id = cambio["id"]
        if sec_id not in secciones:
            errores.append(f"cambios_secciones: sección inexistente '{sec_id}'")
            continue
        errores_cambio = _validar_cambios(cambio["cambios"], TIPOS_SECCION, sec_id)
        errores.extend(errores_cambio)
        if errores_cambio:
            continue
        secciones[sec_id].update(cambio["cambios"])
        horario = secciones[sec_id].get("horario", "")
        partes = horario.split("–")
        if len(partes) != 2 or not all(_hora_valida(h) for h in partes) or partes[0] >= partes[1]:
            errores.append(f"{sec_id}: horario inválido (use HH:MM–HH:MM)")

    for i, ev in enumerate(datos["eventos"]):
        claves = set(ev.keys())
        esperadas = {"origen", "etapas", "bloqueados"}
        if claves != esperadas:
            errores.append(f"eventos[{i}]: debe contener exactamente origen, etapas y bloqueados")
            continue
        if not isinstance(ev["origen"], str):
            errores.append(f"eventos[{i}].origen: debe ser texto")
        for campo in ("etapas", "bloqueados"):
            if not isinstance(ev[campo], list) or any(not isinstance(x, str) for x in ev[campo]):
                errores.append(f"eventos[{i}].{campo}: debe ser una lista de textos")

    if errores:
        return None, errores

    datos.pop("cambios_conexiones")
    datos.pop("cambios_secciones")
    caso = {
        "id": datos.pop("id"),
        "nivel": datos.pop("nivel"),
        "edificio": edificio,
        **datos,
    }
    return caso, []


def validar_borrador_escenario(datos: dict) -> dict:
    """Valida un borrador JSON con ModeloEscenario y validar_escenario."""
    try:
        modelo = ModeloEscenario.model_validate(datos)
    except ValidationError as exc:
        errores = [
            f"{'.'.join(str(p) for p in err['loc']) or 'escenario'}: {err['msg']}"
            for err in exc.errors()
        ]
        return {"valido": False, "errores": errores, "escenario": None}

    caso, errores_construccion = _construir_caso(modelo)
    if errores_construccion or caso is None:
        return {"valido": False, "errores": errores_construccion, "escenario": None}

    try:
        errores_dominio = validar_escenario(caso)
    except Exception:
        LOGGER.exception("Error inesperado en la validación de escenario")
        return {"valido": False, "errores": ["error interno de validación"], "escenario": None}
    if errores_dominio:
        return {"valido": False, "errores": errores_dominio, "escenario": None}

    return {"valido": True, "errores": [], "escenario": modelo.model_dump()}
