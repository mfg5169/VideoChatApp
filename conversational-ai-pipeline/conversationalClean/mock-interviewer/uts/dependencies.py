"""Shared dependencies (e.g. mem_store) set at app startup and injected into routes."""

mem_store = None


def set_mem_store(store):
    global mem_store
    mem_store = store


def get_mem_store():
    return mem_store
