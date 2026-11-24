# RutaSalud

Juego educativo para comparar algoritmos de búsqueda de rutas en una clínica **sintética y ficticia** de 5 pisos. No diagnostica ni reemplaza personal sanitario; no hay datos reales de pacientes. El jugador actúa como orientador siguiendo una orden de destino.

Stack: Python + FastAPI + Pydantic; web nativa con HTML/CSS/JS y SVG; `unittest` y Playwright para pruebas.

## Algoritmos del juego

La interfaz ofrece cuatro algoritmos:

- **BFS**: cola FIFO; explora por capas y garantiza el mínimo número de saltos en grafos no ponderados.
- **DFS**: pila LIFO; profundiza con retroceso y no garantiza la ruta más corta.
- **Dijkstra**: cola de prioridad por costo acumulado `g(n)`; garantiza el costo mínimo con pesos no negativos.
- **A\***: cola de prioridad por `f(n) = g(n) + h(n)`; usa una heurística admisible y consistente.

El motor conserva `greedy` y `bidireccional` como código y evidencia, pero **no se exponen en la UI**.

## Vista multipiso unificada y accesible (`v13.8`)

En lugar de pestañas separadas por piso, el simulador presenta el edificio completo apilado verticalmente en tres modos coordinados (`web/multifloor_graph.js`). Desde `v13.8`, `walk` y `trace` aplican **colapso adaptativo**: los nodos relevantes se calculan antes de dibujar y permanecen fijos durante la reproducción, de modo que solo se reducen los tramos rectos de pasillo de grado 2 no tocados, acumulando sus costos reales en la arista resultante. El SVG y la lista accesible `.sr-only` comparten el mismo conjunto de nodos.

- **Modo `preview` (Elegir estrategia):** presenta el grafo del escenario con nodos circulares grandes (`r >= 20px`), pesos visibles sobre las aristas e indicación visual de incidencias, cierres y accesos bloqueados. Ofrece modo **Esquemático** predeterminado (colapso de tramos rectos de pasillo de grado 2 acumulando su costo real) y conmutador a modo **Completo (16 pts)**.
- **Modo `walk` (Acompaña al paciente):** avance del paciente en vivo sobre el grafo en sincronía con la escena 2D y la tabla de estado de las áreas a cada pulsación de "Avanzar al siguiente punto". Conserva la ruta planificada y todo el historial de posiciones; colapsa únicamente los tramos rectos de grado 2 ajenos a ese conjunto, con costos acumulados reales.
- **Modo `trace` (Exploración del Algoritmo):** reproductor paso a paso de `traza_busqueda` en el resultado. Conserva todos los nodos de la traza completa —origen, destinos, nodos de cada evento, frontera y ruta— desde antes de iniciar el reproductor y colapsa solo los tramos rectos de grado 2 no tocados por esa traza, con costos reales; el dibujo no cambia al avanzar. Incluye métricas de búsqueda, estado de frontera, nodos procesados, descartados y ruta final. En pantallas móviles (`<= 800px`) escala a 980 px de ancho para mantener etiquetas legibles (`>= 11px`).
- **Accesibilidad y navegación táctil/teclado:** cada contenedor cuenta con desplazamiento horizontal asistido por indicación visual (`↔ Desliza horizontalmente...`), foco navegable por teclado (`tabindex="0"`, `role="region"`, `aria-label`), resumen conciso vinculado mediante `aria-describedby` y una lista semántica estructurada de conexiones y pesos por piso en región oculta (`.sr-only`), manteniéndose sincronizada al alternar entre modos y, en `walk`/`trace`, con el mismo `relevantIds` del SVG.

## Ejecutar

Desde `nueva_idea/`, crea el entorno e instala las dependencias:

```powershell
# Windows
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
# Para ejecutar las pruebas, instala también:
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

```bash
# Linux/macOS
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
# Para ejecutar las pruebas, instala también:
./.venv/bin/python -m pip install -r requirements-dev.txt
```

Después inicia la aplicación:

**Windows**
```powershell
.\.venv\Scripts\python.exe -m uvicorn api:app --host 127.0.0.1 --port 8000
```
Abrir `http://127.0.0.1:8000`.

**Linux/macOS**
```bash
./.venv/bin/python -m uvicorn api:app --host 127.0.0.1 --port 8000
```
Abrir `http://127.0.0.1:8000`.

### Persistencia de rondas

Por defecto las rondas viven en memoria y se pierden al reiniciar. Para conservarlas en SQLite, define `RUTASALUD_SQLITE` con la ruta del archivo antes de iniciar la API:

```powershell
# Windows
$env:RUTASALUD_SQLITE = "C:\rutas\rondas.sqlite3"
.\.venv\Scripts\python.exe -m uvicorn api:app --host 127.0.0.1 --port 8000
```
```bash
# Linux/macOS
RUTASALUD_SQLITE=/tmp/rondas.sqlite3 ./.venv/bin/python -m uvicorn api:app --host 127.0.0.1 --port 8000
```

Si la variable no está definida o está vacía, se usa el repositorio en memoria.
Para la demostración, ejecuta `Remove-Item Env:RUTASALUD_SQLITE -ErrorAction SilentlyContinue` en PowerShell antes de iniciar la API, de modo que la nueva sesión use memoria. Esta opción no afecta a servidores ya iniciados.

## Datos y editor

La clínica base está en `data/clinica.json`; los 10 escenarios en `data/escenarios/C01.json`–`C10.json` y la calibración activa por caso en `data/calibracion/`. `escenarios.py` valida la estructura de cada JSON y aplica sus cambios sobre una copia independiente de la clínica. La calibración y el servicio comprueban las reglas del dominio con `validar_escenario`.

El editor de escenarios está en `/editor`. Expone `GET /editor/esquema` y `POST /editor/validar`, reutiliza `ModeloEscenario` y `validar_escenario`, y solo permite descargar el JSON cuando el servidor responde `valido: true`. No escribe directamente en `data/escenarios/`.

## Probar

```powershell
# Windows
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
```
```bash
# Linux/macOS
./.venv/bin/python -m unittest discover -s tests -p "test_*.py"
```

Smoke HTTP: levantar la API en el puerto `8766` y ejecutar `python tests/http_smoke.py`.  
Smoke UI: levantar la API en el puerto `8768` y ejecutar `python tests/ui_smoke.py` (Edge headless).

## Preparar la entrega

En PowerShell, desde la raíz del proyecto, ejecuta `./empaquetar.ps1`. El archivo `entregas/rutasalud-entregable.zip` excluye el entorno virtual, cachés, bases SQLite y archivos ZIP previos. Para instalar las dependencias de ejecución usa `requirements.txt`; para las pruebas, `requirements-dev.txt`.

## Documentación

- [Arquitectura](docs/ARQUITECTURA.md)
- [Uso de IA](docs/IA_USO.md)
- [Guion de exposición](docs/demo/GUION.md)
- [Contrato del proyecto](AGENTS.md)
- [Contrato de interfaz](docs/agentes/UI_CONTRATO.md)
- [Topología](docs/agentes/TOPOLOGIA.md), [pedagogía](docs/agentes/PEDAGOGIA.md) y [arte](docs/agentes/ARTE.md): documentos pendientes de completar.
- Antecedentes conservados en [documentos históricos](docs/historico/) y actas y evidencias en [ejecuciones](ejecuciones/).

## Límites

Simulación académica en una clínica ficticia. No diagnostica, prescribe, determina prioridades para pacientes reales ni reemplaza al personal sanitario. No se introducen datos de pacientes reales; no hay aprendizaje automático. El modelo no refleja un hospital real, normativas locales, tiempos medidos, capacidad de personal, accesibilidad certificada, seguridad contra incendios ni decisiones clínicas. Sin `RUTASALUD_SQLITE` las rondas son solo en memoria; con la variable se persisten localmente en SQLite. No hay autenticación, concurrencia entre procesos validada ni despliegue productivo.
