# -*- coding: utf-8 -*-
"""Simula o usuário enviando comandos (ex.: setpoint) pela API.
Faz login com e-mail/senha de qualquer usuário cadastrado e usa o JWT recebido."""
import getpass

import requests

SERVER = "http://localhost:3000/api"
TIMEOUT = 5

email = input("E-mail: ").strip()
senha = getpass.getpass("Senha: ")

r = requests.post(f"{SERVER}/auth/login", json={"email": email, "senha": senha}, timeout=TIMEOUT)
if r.status_code != 200:
    raise SystemExit(f"Login falhou: {r.status_code} {r.text}")

headers = {"Authorization": f"Bearer {r.json()['token']}"}
print("Login OK. Comandos: setpoint (°C) e ligado (0/1). Enter vazio para sair.")

while True:
    name = input("\nNome do comando (ex: setpoint): ").strip()
    if not name:
        break
    value = input("Valor: ").strip()
    r = requests.post(f"{SERVER}/commands/add", json={"name": name, "value": value},
                      headers=headers, timeout=TIMEOUT)
    print("Resposta:", r.status_code, r.text)
