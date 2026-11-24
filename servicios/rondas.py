"""Servicio de casos, rondas y evaluación."""

from copy import deepcopy
from uuid import uuid4
from servicios.almacen import RondaRepositorio
from fastapi import HTTPException
from escenarios import cargar_escenarios, validar_escenario
from calibracion import preparar_consulta, algoritmos_habilitados
from motor import buscar_ruta, referencia_bellman_ford, evaluar_puntuacion, mediana_superior


class ServicioRondas:
    """Operaciones de juego para una instancia de la aplicación."""

    def __init__(
        self,
        casos: dict,
        filas: list,
        referencia: list,
        fichas: dict,
        repositorio: RondaRepositorio,
    ) -> None:
        self.casos = casos
        self.filas = filas
        self.referencia = referencia
        self.fichas = fichas
        self.repositorio = repositorio
        self.casos_validados = {}

    def catalogo(self) -> list:
        """Procesa catalogo en el servicio de rondas."""

        return [
            dict(
                id=c["id"],
                nivel=c["nivel"],
                dificultad="Fácil"
                if c["nivel"] == 1
                else "Intermedia"
                if c["nivel"] == 2
                else "Difícil",
                paciente=self.fichas[c["id"]].titulo,
                orden=self.fichas[c["id"]].area_destino,
                etapas=c["etapas"],
                movilidad_reducida=c["silla_ruedas"],
                heuristica_disponible=c["heuristica_disponible"],
            )
            for c in self.casos.values()
        ]

    def plano(self, id: str) -> dict:
        """Procesa plano en el servicio de rondas."""

        c, _ = self.obtener(id)

        return dict(
            nodos=c["edificio"]["nodos"],
            conexiones=c["edificio"]["conexiones"],
            secciones=c["edificio"]["secciones"],
            pisos_habilitados=c["pisos_habilitados"],
            hora_caso=c["hora_caso"],
            incidencias_clinica=self.incidencias(c, c["bloqueados_iniciales"]),
        )

    def incidencias(self, c: dict, bloqueados: list) -> list:
        """Procesa incidencias en el servicio de rondas."""

        lista = []

        if c["silla_ruedas"]:
            lista.append(
                dict(tipo="movilidad", silla_ruedas=True, descripcion="Escalera no accesible")
            )

        for grupo in ("ascensor_a", "ascensor_b"):
            conexiones = [e for e in c["edificio"]["conexiones"] if e.get("grupo") == grupo]

            pesos = sorted({e["segundos"] for e in conexiones})

            if grupo in bloqueados:
                lista.append(
                    dict(tipo="ascensor_bloqueado", grupo=grupo, descripcion=f"{grupo} bloqueado")
                )

            elif pesos and max(pesos) > 20:
                lista.append(
                    dict(
                        tipo="ascensor_lento",
                        grupo=grupo,
                        segundos_por_piso=max(pesos),
                        descripcion=f"{grupo} lento ({max(pesos)} s por piso)",
                    )
                )

        for e in c["edificio"]["conexiones"]:
            if e.get("bloqueada") and e.get("grupo") not in bloqueados:
                lista.append(
                    dict(
                        tipo="conexion_bloqueada",
                        origen=e["origen"],
                        destino=e["destino"],
                        grupo=e.get("grupo"),
                        descripcion=f"Conexión {e['origen']} – {e['destino']} bloqueada",
                    )
                )

        for s in c["edificio"]["secciones"]:
            if s["estado"] in ("cerrada", "saturada"):
                lista.append(
                    dict(
                        tipo="sala_" + s["estado"],
                        seccion=s["id"],
                        estado=s["estado"],
                        motivo=s.get("motivo_cierre"),
                        espera_segundos=s.get("espera_segundos", 0),
                    )
                )

        return lista

    def preparar(self, r: dict) -> tuple:
        """Procesa preparar en el servicio de rondas."""

        c, _ = self.obtener(r["escenario"])

        g, d, h = preparar_consulta(c, r["pendientes"][0], r["bloqueados"])

        habilitados = algoritmos_habilitados(c, r["eventos_aplicados"])

        garantizados = [
            a
            for a in habilitados
            if a in ("dijkstra", "astar") or (a == "bfs" and c["costo"] == "tramos")
        ]

        referencia = garantizados or ["dijkstra", "astar"]

        expansiones = sorted(
            (buscar_ruta(g, r["posicion"], d, a, h)["expansiones"] for a in referencia)
        )

        b = mediana_superior(expansiones)

        return (g, d, h, habilitados, garantizados, b)

    def vista(self, r: dict) -> dict:
        """Procesa vista en el servicio de rondas."""

        v = deepcopy(r)

        if r["estado"] in ("eleccion", "recorrido"):
            v["incidencias_clinica"] = self.incidencias(self.casos[r["escenario"]], r["bloqueados"])

        if r["estado"] == "eleccion":
            *_, habilitados, garantizados, b = self.preparar(r)

            pista = (
                self.fichas[r["escenario"]].pista
                if not r["eventos_aplicados"]
                else (
                    "La incidencia cambió las condiciones: revisa posición "
                    "actual, conexiones y destino actualizado."
                )
            )

            v.update(
                objetivo=r["pendientes"][0],
                presupuesto=b,
                algoritmos=habilitados,
                pista_analitica=pista,
            )

        return v

    def ronda(self, id: str) -> dict:
        """Obtiene una ronda existente o informa que no existe."""

        r = self.repositorio.obtener(id)

        if r is None:
            raise HTTPException(404, "Ronda inexistente")

        return r

    def iniciar(self, datos: object) -> dict:
        """Procesa iniciar en el servicio de rondas."""

        c, fs = self.obtener(datos.escenario)

        r = dict(
            id=str(uuid4()),
            escenario=c["id"],
            version=fs[0]["version"],
            estado="eleccion",
            posicion=c["origen"],
            pendientes=list(c["etapas"]),
            bloqueados=list(c["bloqueados_iniciales"]),
            eventos_aplicados=[],
            historial=[{"accion": "inicio", "posicion": c["origen"]}],
            segmentos=[],
            ruta=[],
            indice=0,
            restricciones=dict(silla_ruedas=c["silla_ruedas"], pisos=c["pisos_habilitados"]),
            algoritmo_activo=None,
            duelos_presentados=[
                dict(
                    posicion=c["origen"],
                    objetivo=c["etapas"][0],
                    algoritmos=algoritmos_habilitados(c),
                )
            ],
        )

        self.repositorio.guardar(r)

        return self.vista(r)

    def consultar(self, id: str) -> dict:
        """Procesa consultar en el servicio de rondas."""

        return self.vista(self.ronda(id))

    def elegir(self, id: str, datos: object) -> dict:
        """Procesa elegir en el servicio de rondas."""

        r = self.ronda(id)

        if r["estado"] != "eleccion":
            raise HTTPException(409, "No corresponde elegir")

        self.iniciar_etapa(r, datos.algoritmo)

        return self.vista(r)

    def iniciar_etapa(self, r: dict, algoritmo: str, automatica: bool = False) -> None:
        """Procesa iniciar_etapa en el servicio de rondas."""

        g, d, h, habilitados, garantizados, b = self.preparar(r)

        if algoritmo not in habilitados:
            raise HTTPException(422, "Algoritmo no habilitado")

        c, _ = self.obtener(r["escenario"])

        resultado = buscar_ruta(
            g,
            r["posicion"],
            d,
            algoritmo,
            h,
            trazar=True,
            objetivo=r["pendientes"][0],
            unidad_costo=c["costo"],
        )

        if resultado["ruta"] is None:
            raise HTTPException(409, "Sin ruta")

        r["segmentos"].append(
            dict(
                optimo=referencia_bellman_ford(g, d)[r["posicion"]],
                costo=resultado["costo"],
                garantizado=algoritmo in garantizados,
                expansiones=resultado["expansiones"],
                presupuesto=b,
            )
        )

        if "traza_busqueda" in resultado:
            r["segmentos"][-1]["traza_busqueda"] = resultado["traza_busqueda"]

        r.update(ruta=resultado["ruta"], indice=0, estado="recorrido", algoritmo_activo=algoritmo)

        r["historial"].append(
            dict(
                accion="eleccion",
                algoritmo=algoritmo,
                posicion=r["posicion"],
                presupuesto=b,
                automatica=automatica,
            )
        )

    def avanzar(self, id: str) -> dict:
        """Procesa avanzar en el servicio de rondas."""

        r = self.ronda(id)

        if r["estado"] != "recorrido":
            raise HTTPException(409, "No corresponde avanzar")

        r["indice"] += 1

        nodo = r["ruta"][r["indice"]]

        r["posicion"] = nodo.removeprefix("fin_")

        r["historial"].append(dict(accion="avance", posicion=r["posicion"]))

        if r["indice"] == len(r["ruta"]) - 1:
            r["pendientes"].pop(0)

            c, _ = self.obtener(r["escenario"])

            disparado = False

            for i, event in enumerate(c["eventos"]):
                if (
                    i not in r["eventos_aplicados"]
                    and event["origen"].rsplit("_", 1)[0] == r["posicion"].rsplit("_", 1)[0]
                ):
                    r["pendientes"] = list(event["etapas"])

                    r["bloqueados"] = list(event["bloqueados"])

                    r["eventos_aplicados"].append(i)

                    disparado = True

                    r["historial"].append(
                        dict(
                            accion="evento",
                            evento=i,
                            posicion=r["posicion"],
                            bloqueados=r["bloqueados"][:],
                        )
                    )

            if not r["pendientes"]:
                r["estado"] = "terminada"

            elif disparado:
                r["estado"] = "eleccion"

                r["duelos_presentados"].append(
                    dict(
                        posicion=r["posicion"],
                        objetivo=r["pendientes"][0],
                        algoritmos=algoritmos_habilitados(c, r["eventos_aplicados"]),
                    )
                )

            else:
                self.iniciar_etapa(r, r["algoritmo_activo"], automatica=True)

            r["historial"].append(dict(accion="estado", estado=r["estado"]))

        return self.vista(r)

    def evaluar(self, id: str) -> dict:
        """Procesa evaluar en el servicio de rondas."""

        r = self.ronda(id)

        if r["estado"] != "terminada":
            raise HTTPException(409, "Ronda incompleta")

        ss = r["segmentos"]

        puntuacion = evaluar_puntuacion(
            sum((s["optimo"] for s in ss)),
            sum((s["costo"] for s in ss)),
            all((s["garantizado"] for s in ss)),
            sum((s["expansiones"] for s in ss)),
            sum((s["presupuesto"] for s in ss)),
            True,
        )

        c, _ = self.obtener(r["escenario"])

        ranking = []

        for algoritmo in ("bfs", "dfs", "dijkstra", "astar"):
            posicion = c["origen"]

            pendientes = list(c["etapas"])

            bloqueados = list(c["bloqueados_iniciales"])

            aplicados = set()

            segmentos = []

            usa_ascensor_lento = False

            while pendientes:
                area = pendientes.pop(0)

                g, d, h = preparar_consulta(c, area, bloqueados)

                habilitados = algoritmos_habilitados(c, aplicados)

                garantizados = [
                    a
                    for a in habilitados
                    if a in ("dijkstra", "astar") or (a == "bfs" and c["costo"] == "tramos")
                ]

                garantizados = garantizados or ["dijkstra", "astar"]

                presupuesto = mediana_superior(
                    [buscar_ruta(g, posicion, d, a, h)["expansiones"] for a in garantizados]
                )

                heuristica = (
                    {u: 0 for u in g}
                    if algoritmo == "astar" and (not c["heuristica_disponible"])
                    else h
                )

                resultado = buscar_ruta(g, posicion, d, algoritmo, heuristica)

                if resultado["ruta"] is None:
                    raise HTTPException(409, "Simulación sin ruta")

                if any(
                    (
                        i["tipo"] == "ascensor_lento" and i["grupo"] == "ascensor_a"
                        for i in self.incidencias(c, bloqueados)
                    )
                ):
                    usa_ascensor_lento |= any(("_ascensor_a" in nodo for nodo in resultado["ruta"]))

                segmentos.append(
                    dict(
                        optimo=referencia_bellman_ford(g, d)[posicion],
                        costo=resultado["costo"],
                        expansiones=resultado["expansiones"],
                        presupuesto=presupuesto,
                        garantizado=algoritmo in ("dijkstra", "astar")
                        or (algoritmo == "bfs" and c["costo"] == "tramos"),
                    )
                )

                posicion = resultado["ruta"][-1].removeprefix("fin_")

                for i, event in enumerate(c["eventos"]):
                    if (
                        i not in aplicados
                        and event["origen"].rsplit("_", 1)[0] == posicion.rsplit("_", 1)[0]
                    ):
                        pendientes = list(event["etapas"])

                        bloqueados = list(event["bloqueados"])

                        aplicados.add(i)

            costo = sum((s["costo"] for s in segmentos))

            optimo = sum((s["optimo"] for s in segmentos))

            exp = sum((s["expansiones"] for s in segmentos))

            presupuesto = sum((s["presupuesto"] for s in segmentos))

            evaluacion = evaluar_puntuacion(
                optimo, costo, all((s["garantizado"] for s in segmentos)), exp, presupuesto, True
            )

            if algoritmo == "bfs":
                motivo = (
                    "BFS usa cola FIFO y minimiza saltos con pesos "
                    "uniformes; con tiempos distintos puede elegir "
                    "conexiones lentas. BFS y DFS recorren el grafo en "
                    "O(V+E)."
                )

            elif algoritmo == "dfs":
                motivo = (
                    "DFS usa pila LIFO y retrocede al explorar en "
                    "profundidad; no garantiza la ruta más corta. BFS y DFS "
                    "recorren el grafo en O(V+E)."
                )

            elif algoritmo == "astar":
                motivo = (
                    "A* utiliza cola de prioridad con g+h; con heurística "
                    "admisible y consistente garantiza costo óptimo y una "
                    "estimación informativa puede reducir expansiones."
                )

            else:
                motivo = (
                    "Dijkstra utiliza cola de prioridad y garantiza costo "
                    "mínimo con pesos no negativos; equivale a A* con h=0 y "
                    "no requiere estimación, incluso con varios destinos."
                )

            if usa_ascensor_lento:
                motivo += " La ruta utilizó el ascensor A lento (180 s por piso)."

            if algoritmo == "astar" and (not c["heuristica_disponible"]):
                motivo += (
                    " En C04 no se ofrece una heurística informativa: con "
                    "h=0 equivale a Dijkstra en prioridad."
                )

            ofrecido = any((algoritmo in duelo["algoritmos"] for duelo in r["duelos_presentados"]))

            ranking.append(
                dict(
                    algoritmo=algoritmo,
                    nombre_legible={
                        "bfs": "BFS",
                        "dfs": "DFS",
                        "dijkstra": "Dijkstra",
                        "astar": "A*",
                    }[algoritmo],
                    ofrecido=ofrecido,
                    costo=costo,
                    optimo=optimo,
                    expansiones=exp,
                    presupuesto=presupuesto,
                    **evaluacion,
                    por_que=(
                        f"{motivo} Costo {costo} frente al óptimo por etapas "
                        f"{optimo}; {exp} expansiones frente al presupuesto "
                        f"{presupuesto}."
                    ),
                )
            )

        ranking.sort(key=lambda x: (-x["total"], x["costo"], x["expansiones"], x["algoritmo"]))

        for puesto, item in enumerate(ranking, 1):
            item["puesto"] = puesto

            if puesto == 1:
                item["por_que"] += (
                    " Ocupa el primer puesto por la mayor puntuación; los "
                    "empates se resuelven por menor costo, expansiones e "
                    "identificador."
                )

            else:
                previo = ranking[puesto - 2]

                if item["total"] != previo["total"]:
                    razon = "menor puntuación total"

                elif item["costo"] != previo["costo"]:
                    razon = "mayor costo con igual puntuación"

                elif item["expansiones"] != previo["expansiones"]:
                    razon = "más expansiones con igual puntuación y costo"

                else:
                    razon = "empate numérico, resuelto por identificador del algoritmo"

                item["por_que"] += f" Detrás de {previo['nombre_legible']}: {razon}."

        puntuacion["ranking_algoritmos"] = ranking

        puntuacion["duelos_presentados"] = deepcopy(r["duelos_presentados"])

        return puntuacion

    def obtener(self, id: str) -> tuple:
        """Procesa obtener en el servicio de rondas."""

        if id in self.casos_validados:
            return self.casos_validados[id]

        if id not in self.casos:
            raise HTTPException(404, "Escenario inexistente")

        c = self.casos[id]

        if validar_escenario(c):
            raise HTTPException(409, "Escenario inválido")

        guardadas = [f for f in self.filas if f["caso"] == id]

        actuales = [f for f in self.referencia if f["caso"] == id]

        if (
            not guardadas
            or guardadas != actuales
            or c != next((x for x in cargar_escenarios() if x["id"] == id))
        ):
            raise HTTPException(409, "Calibración ausente o desactualizada")

        self.casos_validados[id] = (c, guardadas)

        return self.casos_validados[id]

    def escenario(self, id: str) -> dict:
        """Procesa escenario en el servicio de rondas."""

        c, datos = self.obtener(id)

        inicial = datos[0]

        return dict(
            id=id,
            objetivo=c["etapas"],
            restricciones=dict(
                silla_ruedas=c["silla_ruedas"],
                pisos=c["pisos_habilitados"],
                bloqueados=c["bloqueados_iniciales"],
            ),
            presupuesto=inicial["presupuesto"],
            version=inicial["version"],
            unidad=c["costo"],
            algoritmos=inicial["habilitados"],
            heuristica_disponible=c["heuristica_disponible"],
            consultas=[
                {k: f[k] for k in ("estado", "origen", "area", "presupuesto")} for f in datos
            ],
        )
