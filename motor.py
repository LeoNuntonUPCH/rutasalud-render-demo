"""Operaciones públicas del motor educativo.

Convención de expansiones (trabajo de búsqueda, no nodos físicos únicos):
una expansión es una extracción válida cuya adyacencia se procesa, incluso
si está vacía. No cuentan descubrimientos, entradas obsoletas, duplicados
cerrados ni reconstrucción de ruta. En búsquedas unidireccionales el destino
extraído finaliza antes de procesar vecinos y no cuenta. En bidireccional
se suman expansiones de ambos frentes: (frente, nodo) es la unidad; un nodo
procesado desde ambos lados cuenta dos veces. Las semillas inversas pueden
contar porque se procesa su adyacencia inversa. No se resta artificialmente
un destino: el algoritmo termina por cota de costos, no por extraerlo.
Origen ya destino da cero en todos. Es trabajo comparable de procesamiento
de adyacencias, no igualdad de cantidades de nodos distintos entre métodos.
Esta definición conserva los contadores y la calibración históricos.

Descubrir: primera inserción válida en la frontera; mejorar una distancia
ya conocida se registra como actualizar_costo (también es descubrimiento
de una alternativa mejor). Procesar/expandir: extracción válida que evalúa
vecinos. Descartar: vecino cerrado, ya descubierto en BFS, costo mayor o
igual al registrado, o entrada obsoleta extraída de la frontera.
"""

from math import isfinite, isclose
from collections import deque
import heapq

CONVENCION_EXPANSIONES = {
    "version": 1,
    "unidad": "procesamiento_de_adyacencia_por_frente",
    "descubrir": "primera inserción en frontera; mejora: actualizar_costo",
    "procesar": "extracción válida que evalúa vecinos, incluso lista vacía",
    "descartar": "cerrado, ya descubierto en BFS, costo no mejor o entrada obsoleta",
    "unidireccional": "el terminal extraído detiene antes de expandir; no cuenta",
    "bidireccional": "suma ambos frentes; un nodo puede contar en cada frente; parada por cota",
}


class _TrazaBusqueda:
    """Registro independiente del estado de búsqueda; no gobierna decisiones.

    IDs terminales se conservan con prefijo fin_ y terminal_seccion=True.
    Frontera contiene IDs únicos en orden de extracción, sin entradas obsoletas.
    El origen es un descubrimiento semilla sin arista. ruta_final no es expansión.
    """

    def __init__(self, algoritmo, origen, destinos, objetivo, unidad):
        self.datos = dict(
            version=1,
            algoritmo=algoritmo,
            origen=origen,
            objetivo=objetivo if objetivo is not None else sorted(destinos),
            destinos=sorted(destinos),
            unidad_costo=unidad,
            convencion_expansiones=dict(CONVENCION_EXPANSIONES),
            total_expansiones_registradas=0,
            eventos=[],
        )

    def emitir(self, tipo, nodo, frontera, metricas, desde=None, costo_arista=None, **extras):
        eventos = self.datos["eventos"]
        eventos.append(
            dict(
                paso=len(eventos) + 1,
                tipo=tipo,
                nodo=nodo,
                terminal_seccion=nodo.startswith("fin_"),
                desde=desde,
                costo_arista=costo_arista,
                metricas=dict(metricas),
                frontera=list(frontera),
                **extras,
            )
        )
        if tipo == "procesar":
            self.datos["total_expansiones_registradas"] += 1


def mediana_superior(valores):
    """Elemento de índice n//2 al ordenar; [41, 64] da 64, no 52.5."""
    ordenados = sorted(valores)
    if not ordenados:
        raise ValueError("La mediana superior requiere valores")
    return ordenados[len(ordenados) // 2]


def referencia_bellman_ford(g, destinos):
    dist = {u: 0 if u in destinos else float("inf") for u in g}
    for _ in range(len(g) - 1):
        anterior = dist.copy()
        for u, vecinos in g.items():
            for v, w in vecinos.items():
                dist[u] = min(dist[u], w + anterior[v])
        if dist == anterior:
            break
    return dist


def verificar_heuristica(g, destinos, h):
    errores = []
    if set(h) != set(g) or any(not isfinite(v) or v < 0 for v in h.values()):
        return ["Heurística incompleta o inválida"]
    referencia = referencia_bellman_ford(g, destinos)
    for u in g:
        if u in destinos and h[u] != 0:
            errores.append("Destino con heurística distinta de cero")
        if h[u] > referencia[u] + 1e-9:
            errores.append("Heurística no admisible")
        for v, w in g[u].items():
            if h[u] > w + h[v] + 1e-9:
                errores.append("Heurística inconsistente")
    return errores


def buscar_ruta(
    g,
    origen,
    destinos,
    algoritmo="dijkstra",
    heuristica=None,
    *,
    trazar=False,
    objetivo=None,
    unidad_costo="segundos",
):
    """Busca sin alterar el contrato histórico salvo traza opcional.

    trazar=True registra los seis algoritmos. La API aporta área y
    unidad; llamadas genéricas pueden aportar objetivo o usar destinos.
    """
    destinos = set(destinos)
    if algoritmo not in ("bfs", "dfs", "dijkstra", "astar", "greedy", "bidireccional"):
        raise ValueError("Algoritmo no implementado")
    if origen not in g or not destinos.issubset(g):
        raise ValueError("Nodo inexistente")
    for vecinos in g.values():
        for v, w in vecinos.items():
            if v not in g or not isfinite(w) or w < 0:
                raise ValueError("Arista inválida")
    if trazar and unidad_costo not in ("tramos", "segundos"):
        raise ValueError("Unidad de costo inválida")
    if algoritmo == "bidireccional":
        return _bidireccional(g, origen, destinos, trazar, objetivo, unidad_costo)
    h = heuristica or {u: 0 for u in g}
    if algoritmo == "astar" and verificar_heuristica(g, destinos, h):
        raise ValueError("A* requiere una heurística admisible y consistente")
    pendientes = deque([origen])
    heap = [(h[origen] if algoritmo in ("astar", "greedy") else 0, origen, 0)]
    distancia, padre, cerrados = {origen: 0}, {origen: None}, set()
    profundidad = {origen: 0} if trazar else None
    traza = _TrazaBusqueda(algoritmo, origen, destinos, objetivo, unidad_costo) if trazar else None

    def registrar(tipo, nodo, desde=None, peso=None, anterior=None, **extras):
        if traza is None:
            return
        if algoritmo in ("bfs", "dfs"):
            frontera = list(pendientes) if algoritmo == "bfs" else list(reversed(pendientes))
            metricas = {"profundidad": profundidad[nodo]}
        else:
            # sorted es una copia: nunca altera el heap de ejecución.
            frontera = list(
                dict.fromkeys(
                    v for _, v, costo in sorted(heap) if v not in cerrados and costo == distancia[v]
                )
            )
            if algoritmo == "astar":
                metricas = {
                    "g": distancia[nodo],
                    "h": h[nodo],
                    "f": distancia[nodo] + h[nodo],
                    "g_anterior": anterior,
                }
            elif algoritmo == "greedy":
                metricas = {"h": h[nodo]}
            else:
                metricas = {"costo_acumulado": distancia[nodo], "costo_anterior": anterior}
        traza.emitir(tipo, nodo, frontera, metricas, desde, peso, **extras)

    def finalizar(ruta, costo):
        resultado = dict(ruta=ruta, costo=costo, expansiones=expansiones)
        if traza is not None:
            registrar("ruta_final", ruta[-1] if ruta else origen, ruta=ruta, costo=costo)
            assert traza.datos["total_expansiones_registradas"] == expansiones
            resultado["traza_busqueda"] = traza.datos
        return resultado

    expansiones = 0
    registrar("descubrir", origen)
    while pendientes if algoritmo in ("bfs", "dfs") else heap:
        if algoritmo in ("bfs", "dfs"):
            u = pendientes.popleft() if algoritmo == "bfs" else pendientes.pop()
        else:
            _, u, costo = heapq.heappop(heap)
            if costo != distancia[u]:
                registrar("descartar", u, motivo="entrada_obsoleta")
                continue
        if u in cerrados:
            registrar("descartar", u, motivo="ya_procesado")
            continue
        cerrados.add(u)
        if u in destinos:
            registrar("objetivo_alcanzado", u)
            ruta, actual = [], u
            while actual is not None:
                ruta.append(actual)
                actual = padre[actual]
            return finalizar(ruta[::-1], distancia[u])
        # Unidad común: se va a procesar una lista de adyacencia válida.
        expansiones += 1
        registrar("procesar", u)
        for v, w in sorted(g[u].items(), reverse=algoritmo == "dfs"):
            if v in cerrados:
                registrar("descartar", v, u, w, distancia.get(v), motivo="ya_procesado")
                continue
            nuevo = distancia[u] + w
            if algoritmo in ("bfs", "dfs", "greedy"):
                if v in padre:
                    registrar("descartar", v, u, w, distancia.get(v), motivo="ya_descubierto")
                    continue
            elif nuevo >= distancia.get(v, float("inf")):
                registrar("descartar", v, u, w, distancia.get(v), motivo="costo_no_mejor")
                continue
            anterior = distancia.get(v)
            distancia[v], padre[v] = nuevo, u
            if traza is not None:
                profundidad[v] = profundidad[u] + 1
            if algoritmo in ("bfs", "dfs"):
                pendientes.append(v)
            else:
                prioridad = (
                    h[v] if algoritmo == "greedy" else nuevo + (h[v] if algoritmo == "astar" else 0)
                )
                heapq.heappush(heap, (prioridad, v, nuevo))
            registrar("descubrir" if anterior is None else "actualizar_costo", v, u, w, anterior)
    return finalizar(None, None)


def _bidireccional(g, origen, destinos, trazar=False, objetivo=None, unidad_costo="segundos"):
    traza = (
        _TrazaBusqueda("bidireccional", origen, destinos, objetivo, unidad_costo)
        if trazar
        else None
    )
    if origen in destinos:
        resultado = dict(ruta=[origen], costo=0, expansiones=0)
        if traza:
            m = dict(frente="origen", costo_acumulado=0, costo_anterior=None, nodo_encuentro=origen)
            traza.emitir("descubrir", origen, [origen], m)
            traza.emitir("objetivo_alcanzado", origen, [], m)
            traza.emitir("ruta_final", origen, [], m, ruta=[origen], costo=0)
            resultado["traza_busqueda"] = traza.datos
        return resultado
    inverso = {u: {} for u in g}
    for u in g:
        for v, w in g[u].items():
            inverso[v][u] = w
    grafos = [g, inverso]
    dist = [{origen: 0}, {v: 0 for v in destinos}]
    padres = [{origen: None}, {v: None for v in destinos}]
    heaps = [[(0, origen)], [(0, v) for v in sorted(destinos)]]
    cerrados = [set(), set()]
    mejor, encuentro, expansiones = float("inf"), None, 0

    def registrar(tipo, lado, nodo, desde=None, peso=None, anterior=None, **extra):
        if traza is None:
            return
        frontera = list(
            dict.fromkeys(
                v for d, v in sorted(heaps[lado]) if v not in cerrados[lado] and d == dist[lado][v]
            )
        )
        met = dict(
            frente="origen" if lado == 0 else "destino",
            costo_acumulado=dist[lado][nodo],
            costo_anterior=anterior,
            nodo_encuentro=encuentro,
        )
        traza.emitir(tipo, nodo, frontera, met, desde, peso, **extra)

    registrar("descubrir", 0, origen)
    for v in sorted(destinos):
        registrar("descubrir", 1, v)
    while all(heaps):
        for lado in (0, 1):
            while heaps[lado] and (
                heaps[lado][0][1] in cerrados[lado]
                or heaps[lado][0][0] != dist[lado][heaps[lado][0][1]]
            ):
                _, obsoleto = heapq.heappop(heaps[lado])
                registrar("descartar", lado, obsoleto, motivo="entrada_obsoleta_o_cerrada")
        if not all(heaps) or heaps[0][0][0] + heaps[1][0][0] >= mejor:
            break
        lado = 0 if heaps[0][0] <= heaps[1][0] else 1
        d, u = heapq.heappop(heaps[lado])
        cerrados[lado].add(u)
        # Misma unidad; cada frente mantiene su propio conjunto de cerrados.
        expansiones += 1
        registrar("procesar", lado, u)
        for v, w in sorted(grafos[lado][u].items()):
            nuevo = d + w
            anterior = dist[lado].get(v)
            if nuevo < dist[lado].get(v, float("inf")):
                dist[lado][v] = nuevo
                padres[lado][v] = u
                heapq.heappush(heaps[lado], (nuevo, v))
                registrar(
                    "descubrir" if anterior is None else "actualizar_costo",
                    lado,
                    v,
                    u,
                    w,
                    anterior,
                    arista_inversa=bool(lado),
                )
            else:
                registrar(
                    "descartar",
                    lado,
                    v,
                    u,
                    w,
                    anterior,
                    motivo="costo_no_mejor",
                    arista_inversa=bool(lado),
                )
            candidato = dist[lado].get(v, float("inf")) + dist[1 - lado].get(v, float("inf"))
            if candidato < mejor:
                mejor, encuentro = candidato, v
    if encuentro is None:
        resultado = dict(ruta=None, costo=None, expansiones=expansiones)
        if traza:
            registrar("ruta_final", 0, origen, ruta=None, costo=None)
            resultado["traza_busqueda"] = traza.datos
        return resultado
    ruta = []
    u = encuentro
    while u is not None:
        ruta.append(u)
        u = padres[0][u]
    ruta.reverse()
    u = padres[1][encuentro]
    while u is not None:
        ruta.append(u)
        u = padres[1][u]
    resultado = dict(ruta=ruta, costo=mejor, expansiones=expansiones)
    if traza:
        registrar("objetivo_alcanzado", 0, encuentro)
        registrar("ruta_final", 0, encuentro, ruta=ruta, costo=mejor)
        resultado["traza_busqueda"] = traza.datos
    return resultado


def evaluar_puntuacion(
    optimo, costo, garantizado, expansiones, presupuesto, restricciones, destino_valido=True
):
    if any(not isfinite(x) or x < 0 for x in (optimo, costo, expansiones, presupuesto)):
        raise ValueError("Las métricas deben ser finitas y no negativas")
    if costo < optimo and not isclose(costo, optimo):
        raise ValueError("Costo inferior a la referencia")
    if expansiones == 0 and costo > 0:
        raise ValueError("Un recorrido de costo positivo requiere expansiones")
    if int(expansiones) != expansiones or int(presupuesto) != presupuesto:
        raise ValueError("Expansiones y presupuesto deben ser enteros")
    partes = dict(estrategia=0, calidad=0, exploracion=0, restricciones=0)
    if destino_valido:
        partes["estrategia"] = 20 if garantizado else 10 if isclose(costo, optimo) else 0
        partes["calidad"] = 40 if costo == 0 else 40 * optimo / costo
        partes["exploracion"] = 25 if expansiones == 0 else 25 * min(1, presupuesto / expansiones)
        partes["restricciones"] = 15 if restricciones else 0
    total = round(sum(partes.values()), 2)
    return dict(
        componentes={k: round(v, 2) for k, v in partes.items()},
        total=total,
        victoria=destino_valido and restricciones and total >= 80,
    )
