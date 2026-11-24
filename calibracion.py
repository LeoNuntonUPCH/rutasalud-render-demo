"""Calibración reproducible por consulta; ejecutar para exportar evidencia."""

import json
import csv
from pathlib import Path
from math import dist, isclose
from clinica import conexiones_accesibles, secciones_disponibles
from escenarios import cargar_escenarios, validar_escenario
from motor import buscar_ruta, referencia_bellman_ford, verificar_heuristica

ALGORITMOS = ("bfs", "dfs", "dijkstra", "astar", "greedy", "bidireccional")


def algoritmos_habilitados(caso, eventos_aplicados=()):
    """Pareja para la decisión actual; C09 cambia únicamente tras su evento."""
    if caso["id"] in ("C01", "C02", "C03") or (caso["id"] == "C09" and not eventos_aplicados):
        return ["bfs", "dfs"]
    return ["dijkstra", "astar"]


def preparar_consulta(caso, area, bloqueados=()):
    edificio = caso["edificio"]
    nodos = {u: n for u, n in edificio["nodos"].items() if n["piso"] in caso["pisos_habilitados"]}
    g = {u: {} for u in nodos}
    for e in conexiones_accesibles(edificio, caso["silla_ruedas"], bloqueados):
        a, b = e["origen"], e["destino"]
        if a in g and b in g:
            w = 1 if caso["costo"] == "tramos" else e["segundos"]
            g[a][b] = w
            g[b][a] = w
    salas = [s for s in secciones_disponibles(edificio, area) if s["id"] in g]
    coordenadas = {u: (n["x"], n["y"], 4 * n["piso"]) for u, n in nodos.items()}
    terminales = set()
    for s in salas:
        u = s["id"]
        t = "fin_" + u
        g[t] = {}
        g[u][t] = s["espera_segundos"] if caso["costo"] == "segundos" else 0
        coordenadas[t] = coordenadas[u]
        terminales.add(t)
    razones = [
        w / dist(coordenadas[u], coordenadas[v])
        for u in g
        for v, w in g[u].items()
        if dist(coordenadas[u], coordenadas[v]) > 0
    ]
    escala = min(razones, default=0)
    h = {
        u: min((dist(coordenadas[u], coordenadas[t]) * escala for t in terminales), default=0)
        for u in g
    }
    if not caso.get("heuristica_disponible", True):
        h = {u: 0 for u in g}
    return g, terminales, h


def calibrar_escenarios():
    filas = []
    for caso in cargar_escenarios():
        if validar_escenario(caso):
            raise ValueError("Escenario inválido: " + caso["id"])
        consultas = []
        origen = caso["origen"]
        # Orígenes canónicos compartidos: primera sección abierta de la etapa anterior.
        for area in caso["etapas"]:
            consultas.append(("inicial", origen, area, caso["bloqueados_iniciales"]))
            origen = sorted(s["id"] for s in secciones_disponibles(caso["edificio"], area))[0]
        for i, event in enumerate(caso["eventos"]):
            origen = event["origen"]
            for area in event["etapas"]:
                consultas.append((f"evento_{i + 1}", origen, area, event["bloqueados"]))
                origen = sorted(s["id"] for s in secciones_disponibles(caso["edificio"], area))[0]
        for estado, origen, area, bloqueados in consultas:
            g, destinos, h = preparar_consulta(caso, area, bloqueados)
            errores = verificar_heuristica(g, destinos, h)
            if errores:
                raise ValueError(errores)
            optimo = referencia_bellman_ford(g, destinos)[origen]
            resultados = {a: buscar_ruta(g, origen, destinos, a, h) for a in ALGORITMOS}
            for a in ("dijkstra", "astar", "bidireccional"):
                if not isclose(resultados[a]["costo"], optimo):
                    raise AssertionError((caso["id"], a))
            habilitados = algoritmos_habilitados(caso, () if estado == "inicial" else (0,))
            garantizados = [a for a in ("dijkstra", "astar") if a in habilitados]
            # En niveles uniformes cada destino tiene exactamente una arista
            # terminal de costo cero: minimizar aristas equivale a costo + 1.
            if caso["costo"] == "tramos" and "bfs" in habilitados:
                garantizados.append("bfs")
            if not garantizados:
                garantizados = ["dijkstra", "astar"]
            # Mediana: dos estrategias garantizadas pueden cumplir el reto sin
            # premiar únicamente la que explora menos nodos.
            expansiones_ordenadas = sorted(resultados[a]["expansiones"] for a in garantizados)
            presupuesto = expansiones_ordenadas[len(expansiones_ordenadas) // 2]
            filas.append(
                dict(
                    caso=caso["id"],
                    version=5,
                    estado=estado,
                    origen=origen,
                    area=area,
                    garantizados=garantizados,
                    habilitados=habilitados,
                    destinos=sorted(destinos),
                    unidad=caso["costo"],
                    optimo=optimo,
                    presupuesto=presupuesto,
                    errores_heuristica=errores,
                    resultados=resultados,
                )
            )
    return filas


if __name__ == "__main__":
    filas = calibrar_escenarios()
    carpeta = Path(__file__).with_name("resultados_fase3")
    carpeta.mkdir(exist_ok=True)
    (carpeta / "calibracion.json").write_text(
        json.dumps(filas, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    with (carpeta / "comparacion.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "caso",
                "estado",
                "origen",
                "area",
                "algoritmo",
                "costo",
                "expansiones",
                "optimo",
                "presupuesto",
            ]
        )
        for fila in filas:
            for a, r in fila["resultados"].items():
                writer.writerow(
                    [
                        fila["caso"],
                        fila["estado"],
                        fila["origen"],
                        fila["area"],
                        a,
                        r["costo"],
                        r["expansiones"],
                        fila["optimo"],
                        fila["presupuesto"],
                    ]
                )
    print(f"{len(filas)} consultas guardadas")
