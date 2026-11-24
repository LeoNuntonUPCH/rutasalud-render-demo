"""Repositorios de rondas: memoria por instancia y persistencia SQLite opcional."""

from abc import ABC, abstractmethod
from copy import deepcopy
from contextlib import closing
import json
from pathlib import Path
import sqlite3


class RondaRepositorio(ABC):
    """Contrato de acceso al estado de las rondas."""

    @abstractmethod
    def obtener(self, identificador: str) -> dict | None:
        """Devuelve la ronda o None si no existe."""

    @abstractmethod
    def guardar(self, ronda: dict) -> None:
        """Almacena una ronda identificada por su id."""


class EnMemoria(RondaRepositorio):
    """Almacén temporal de rondas de una aplicación."""

    def __init__(self) -> None:
        self._rondas = {}

    def obtener(self, identificador: str) -> dict | None:
        return self._rondas.get(identificador)

    def guardar(self, ronda: dict) -> None:
        self._rondas[ronda["id"]] = ronda


def _observar(valor, cambio):
    if isinstance(valor, dict):
        return _DiccionarioObservado(valor, cambio)
    if isinstance(valor, list):
        return _ListaObservada(valor, cambio)
    return valor


class _DiccionarioObservado(dict):
    def __init__(self, datos, cambio):
        self._cambio = cambio
        super().__init__((k, _observar(v, cambio)) for k, v in datos.items())

    def __setitem__(self, clave, valor):
        super().__setitem__(clave, _observar(valor, self._cambio))
        self._cambio()

    def update(self, *args, **kwargs):
        for clave, valor in dict(*args, **kwargs).items():
            dict.__setitem__(self, clave, _observar(valor, self._cambio))
        self._cambio()

    def __delitem__(self, clave):
        super().__delitem__(clave)
        self._cambio()

    def pop(self, clave, *default):
        existe = clave in self
        valor = super().pop(clave, *default)
        if existe:
            self._cambio()
        return valor

    def clear(self):
        super().clear()
        self._cambio()

    def setdefault(self, clave, valor=None):
        if clave not in self:
            self[clave] = valor
        return self[clave]

    def __deepcopy__(self, memo):
        return {deepcopy(k, memo): deepcopy(v, memo) for k, v in self.items()}


class _ListaObservada(list):
    def __init__(self, datos, cambio):
        self._cambio = cambio
        super().__init__(_observar(v, cambio) for v in datos)

    def append(self, valor):
        super().append(_observar(valor, self._cambio))
        self._cambio()

    def pop(self, indice=-1):
        valor = super().pop(indice)
        self._cambio()
        return valor

    def __setitem__(self, indice, valor):
        if isinstance(indice, slice):
            valor = [_observar(v, self._cambio) for v in valor]
        else:
            valor = _observar(valor, self._cambio)
        super().__setitem__(indice, valor)
        self._cambio()

    def __delitem__(self, indice):
        super().__delitem__(indice)
        self._cambio()

    def extend(self, valores):
        super().extend(_observar(valor, self._cambio) for valor in valores)
        self._cambio()

    def insert(self, indice, valor):
        super().insert(indice, _observar(valor, self._cambio))
        self._cambio()

    def clear(self):
        super().clear()
        self._cambio()

    def remove(self, valor):
        super().remove(valor)
        self._cambio()

    def __deepcopy__(self, memo):
        return [deepcopy(v, memo) for v in self]


class SQLite(RondaRepositorio):
    """Persiste rondas en SQLite y registra las mutaciones anidadas del servicio."""

    def __init__(self, ruta: str | Path) -> None:
        self.ruta = str(ruta)
        with closing(sqlite3.connect(self.ruta)) as conexion, conexion:
            conexion.execute(
                "CREATE TABLE IF NOT EXISTS rondas (id TEXT PRIMARY KEY, datos TEXT NOT NULL)"
            )

    def obtener(self, identificador: str) -> dict | None:
        """Carga una ronda cuyo estado modificado se guarda automáticamente."""
        with closing(sqlite3.connect(self.ruta)) as conexion, conexion:
            fila = conexion.execute(
                "SELECT datos FROM rondas WHERE id = ?", (identificador,)
            ).fetchone()
        if fila is None:
            return None
        raiz = None

        def persistir():
            self.guardar(raiz)

        raiz = _DiccionarioObservado(json.loads(fila[0]), persistir)
        return raiz

    def guardar(self, ronda: dict) -> None:
        """Inserta o actualiza una ronda completa mediante una transacción."""
        datos = json.dumps(ronda, ensure_ascii=False, allow_nan=False)
        with closing(sqlite3.connect(self.ruta)) as conexion, conexion:
            conexion.execute(
                "INSERT INTO rondas(id, datos) VALUES (?, ?) "
                "ON CONFLICT(id) DO UPDATE SET datos = excluded.datos",
                (ronda["id"], datos),
            )
