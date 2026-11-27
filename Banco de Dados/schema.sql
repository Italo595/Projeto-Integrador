-- schema.sql - Projeto Integrador SCOM 2026 (SQLite)
-- Habilita o uso de chaves estrangeiras (essencial no SQLite)
PRAGMA foreign_keys = ON;

-- ---------- Usuários (2 níveis de acesso) ----------
CREATE TABLE usuarios (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nome           TEXT NOT NULL,
    email          TEXT NOT NULL UNIQUE,
    senha_hash     TEXT NOT NULL,              -- bcrypt/argon2, nunca a senha
    papel          TEXT CHECK(papel IN ('admin', 'comum')) NOT NULL DEFAULT 'comum',
    ativo          INTEGER NOT NULL DEFAULT 1, -- 1 = true, 0 = false
    tentativas_falhas INTEGER NOT NULL DEFAULT 0,
    bloqueado_ate  DATETIME,
    ultimo_login   DATETIME,
    criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Refresh tokens
CREATE TABLE refresh_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expira_em   DATETIME NOT NULL,
    revogado    INTEGER NOT NULL DEFAULT 0, -- 1 = true, 0 = false
    criado_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Dispositivos (ESP32 / simulador) ----------
CREATE TABLE dispositivos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id      TEXT NOT NULL UNIQUE,
    nome           TEXT,
    token_hash     TEXT NOT NULL,
    ultimo_contato DATETIME,
    ativo          INTEGER NOT NULL DEFAULT 1, -- 1 = true, 0 = false
    criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Leituras ----------
CREATE TABLE leituras (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dispositivo_id INTEGER NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
    ts             DATETIME NOT NULL,
    temperatura    TEXT,
    setpoint       TEXT,
    pwm            TEXT,
    variaveis      TEXT NOT NULL DEFAULT '{}', -- SQLite armazena JSON como TEXT
    recebido_em    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE INDEX idx_leituras_disp_ts ON leituras (dispositivo_id, ts DESC);

-- ---------- Comandos / histórico de setpoint ----------
CREATE TABLE comandos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dispositivo_id INTEGER NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
    usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    nome           TEXT NOT NULL,
    valor          TEXT NOT NULL,
    valor_anterior TEXT,
    status         TEXT CHECK(status IN ('pendente', 'enviado', 'confirmado', 'falhou')) NOT NULL DEFAULT 'pendente',
    criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    enviado_em     DATETIME,
    confirmado_em  DATETIME
);
CREATE INDEX idx_comandos_pendentes ON comandos (dispositivo_id, status) WHERE status IN ('pendente', 'enviado');

-- ---------- Configuração atual do controlador ----------
CREATE TABLE config_controle (
    dispositivo_id INTEGER PRIMARY KEY REFERENCES dispositivos(id) ON DELETE CASCADE,
    setpoint       TEXT,
    kp             REAL NOT NULL DEFAULT 1.2,
    ki             REAL NOT NULL DEFAULT 0.05,
    kd             REAL NOT NULL DEFAULT 0.0,
    sat_min        REAL NOT NULL DEFAULT 0.0,
    sat_max        REAL NOT NULL DEFAULT 255.0,
    ligado         INTEGER NOT NULL DEFAULT 0, -- 1 = true, 0 = false
    atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    atualizado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Logs / auditoria ----------
CREATE TABLE logs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nivel          TEXT CHECK(nivel IN ('INFO', 'WARN', 'ERROR')) NOT NULL DEFAULT 'INFO',
    acao           TEXT NOT NULL,
    mensagem       TEXT NOT NULL,
    usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    dispositivo_id INTEGER REFERENCES dispositivos(id) ON DELETE SET NULL,
    ip             TEXT,
    criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_logs_criado ON logs (criado_em DESC);

-- ---------- Backups ----------
CREATE TABLE backups (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    arquivo         TEXT NOT NULL,
    tamanho_bytes   INTEGER,
    sha256          TEXT,
    tipo            TEXT CHECK(tipo IN ('periodico', 'manual')) NOT NULL DEFAULT 'periodico',
    status          TEXT CHECK(status IN ('ok', 'erro')) NOT NULL DEFAULT 'ok',
    erro            TEXT,
    criado_por      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    restaurado_em   DATETIME,
    restaurado_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);

-- ---------- Experimentos ----------
CREATE TABLE experimentos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    dispositivo_id INTEGER REFERENCES dispositivos(id) ON DELETE SET NULL,
    usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    modo           TEXT NOT NULL CHECK (modo IN ('simulada', 'real')),
    cenario        TEXT NOT NULL, -- SQLite armazena JSON como TEXT
    metricas       TEXT,          -- SQLite armazena JSON como TEXT
    iniciado_em    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalizado_em  DATETIME
);