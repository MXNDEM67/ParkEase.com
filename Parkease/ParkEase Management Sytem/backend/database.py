import os
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, cast

import mysql.connector
from mysql.connector import Error as MySQLError
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
SQL_FILE = BASE_DIR / "database.sql"
load_dotenv(BASE_DIR / ".env")


def get_mysql_config():
    return {
        "host": os.getenv("MYSQL_HOST", "127.0.0.1"),
        "port": int(os.getenv("MYSQL_PORT", "3306")),
        "user": os.getenv("MYSQL_USER", "root"),
        "password": os.getenv("MYSQL_PASSWORD", ""),
        "database": os.getenv("MYSQL_DATABASE", "parkease"),
        "autocommit": True,
    }


def get_connection(database=None, **overrides):
    config = get_mysql_config()
    if database is not None:
        config["database"] = database
    config.update(overrides)
    return mysql.connector.connect(**config)


def _datetime_to_iso(value):
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def load_parking_state() -> dict[str, Any]:
    connection = get_connection()
    cursor = None
    try:
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT hourly_rate, cash_enabled, online_enabled FROM settings WHERE id = 1"
        )
        settings_row = cursor.fetchone()
        if settings_row is None:
            raise RuntimeError("The settings row is missing; initialize the database first.")
        settings_row = cast(dict[str, Any], settings_row)
        settings = {
            "hourlyRate": float(settings_row["hourly_rate"]),
            "paymentMethods": {
                "cash": bool(settings_row["cash_enabled"]),
                "online": bool(settings_row["online_enabled"]),
            },
        }

        cursor.execute(
            "SELECT spaces.id, spaces.status, sessions.plate_number, "
            "sessions.session_code, sessions.started_at "
            "FROM parking_spaces AS spaces "
            "LEFT JOIN parking_sessions AS sessions "
            "ON sessions.parking_space_id = spaces.id "
            "ORDER BY spaces.id"
        )
        spaces = []
        for row in cursor.fetchall():
            row = cast(dict[str, Any], row)
            spaces.append({
                "id": row["id"],
                "status": row["status"],
                "vehicle": row["plate_number"] or "",
                "ticketNumber": row["session_code"] or "",
                "startedAt": _datetime_to_iso(row["started_at"]),
            })

        cursor.execute(
            "SELECT session_code, plate_number, parking_space_id, started_at "
            "FROM parking_sessions ORDER BY started_at DESC"
        )
        sessions = []
        for row in cursor.fetchall():
            row = cast(dict[str, Any], row)
            sessions.append({
                "sessionId": row["session_code"],
                "plateNumber": row["plate_number"],
                "parkingSpace": row["parking_space_id"],
                "startedAt": _datetime_to_iso(row["started_at"]),
            })

        cursor.execute(
            "SELECT ticket_number, plate_number, parking_space_id, hours, "
            "duration_text, amount, payment_method, entry_time, paid_at, status "
            "FROM tickets ORDER BY paid_at DESC"
        )
        tickets = []
        for row in cursor.fetchall():
            row = cast(dict[str, Any], row)
            tickets.append({
                "ticketNumber": row["ticket_number"],
                "plateNumber": row["plate_number"],
                "parkingSpace": row["parking_space_id"],
                "hours": row["hours"],
                "duration": row["duration_text"],
                "amount": float(row["amount"]),
                "paymentMethod": row["payment_method"],
                "entryTime": _datetime_to_iso(row["entry_time"]),
                "paidAt": _datetime_to_iso(row["paid_at"]),
                "status": row["status"],
            })
        return {"settings": settings, "spaces": spaces, "sessions": sessions, "tickets": tickets}
    finally:
        if cursor is not None:
            cursor.close()
        if connection.is_connected():
            connection.close()


def save_settings(settings: dict[str, Any]) -> None:
    connection = get_connection()
    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "UPDATE settings SET hourly_rate = %s, cash_enabled = %s, online_enabled = %s "
            "WHERE id = 1",
            (
                Decimal(str(settings["hourlyRate"])).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP
                ),
                settings["paymentMethods"]["cash"],
                settings["paymentMethods"]["online"],
            ),
        )
    finally:
        if cursor is not None:
            cursor.close()
        if connection.is_connected():
            connection.close()


def create_parking_session(plate_number: str, parking_space: str) -> dict[str, str]:
    connection = get_connection(autocommit=False)
    cursor = None
    try:
        connection.start_transaction()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, status FROM parking_spaces WHERE id = %s FOR UPDATE",
            (parking_space,),
        )
        space = cursor.fetchone()
        if space is None:
            raise ValueError("Parking space not found.")
        if cast(dict[str, Any], space)["status"] == "occupied":
            raise ValueError("Parking space already occupied.")

        cursor.execute(
            "SELECT session_code FROM parking_sessions WHERE plate_number = %s",
            (plate_number,),
        )
        if cursor.fetchone() is not None:
            raise ValueError("A session for this plate number is already active.")

        started_at = datetime.now(timezone.utc)
        session_id = f"PS-{uuid.uuid4().hex[:20]}"
        cursor.execute(
            "INSERT INTO parking_sessions "
            "(session_code, plate_number, parking_space_id, started_at) "
            "VALUES (%s, %s, %s, %s)",
            (session_id, plate_number, parking_space, started_at.replace(tzinfo=None)),
        )
        cursor.execute(
            "UPDATE parking_spaces SET status = 'occupied' WHERE id = %s",
            (parking_space,),
        )
        connection.commit()
        return {
            "sessionId": session_id,
            "plateNumber": plate_number,
            "parkingSpace": parking_space,
            "startedAt": started_at.isoformat(),
        }
    except mysql.connector.IntegrityError as exc:
        connection.rollback()
        raise ValueError("A vehicle or parking space already has an active session.") from exc
    except Exception:
        connection.rollback()
        raise
    finally:
        if cursor is not None:
            cursor.close()
        if connection.is_connected():
            connection.close()


def complete_parking_session(session_id: str, payment_method: str) -> dict[str, Any]:
    connection = get_connection(autocommit=False)
    cursor = None
    try:
        connection.start_transaction()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT session_code, plate_number, parking_space_id, started_at "
            "FROM parking_sessions WHERE session_code = %s FOR UPDATE",
            (session_id,),
        )
        session = cursor.fetchone()
        if session is None:
            raise ValueError("Session not found.")
        session = cast(dict[str, Any], session)
        cursor.execute(
            "SELECT hourly_rate, cash_enabled, online_enabled FROM settings WHERE id = 1"
        )
        settings = cast(dict[str, Any] | None, cursor.fetchone())
        if settings is None:
            raise RuntimeError("The settings row is missing; initialize the database first.")
        if not settings[f"{payment_method}_enabled"]:
            raise ValueError("This payment method is disabled.")

        now = datetime.now(timezone.utc)
        started_at = session["started_at"]
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        elapsed_ms = max(0, int((now - started_at).total_seconds() * 1000))
        total_minutes = elapsed_ms // 60000
        duration_hours, duration_minutes = divmod(total_minutes, 60)
        hours = max(1, (elapsed_ms + 3_599_999) // 3_600_000)
        duration = (
            f"{duration_hours} hr{'s' if duration_hours != 1 else ''} "
            f"{duration_minutes:02d} min{'s' if duration_minutes != 1 else ''}"
        )
        amount = (
            Decimal(hours) * Decimal(str(settings["hourly_rate"]))
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        ticket_number = f"PK-{uuid.uuid4().hex[:20]}"
        cursor.execute(
            "INSERT INTO tickets "
            "(ticket_number, session_code, plate_number, parking_space_id, hours, "
            "duration_text, amount, payment_method, entry_time, paid_at, status) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'PAID')",
            (
                ticket_number,
                session_id,
                session["plate_number"],
                session["parking_space_id"],
                hours,
                duration,
                amount,
                payment_method,
                started_at.replace(tzinfo=None),
                now.replace(tzinfo=None),
            ),
        )
        cursor.execute(
            "DELETE FROM parking_sessions WHERE session_code = %s",
            (session_id,),
        )
        cursor.execute(
            "UPDATE parking_spaces SET status = 'available' WHERE id = %s",
            (session["parking_space_id"],),
        )
        connection.commit()
        return {
            "ticketNumber": ticket_number,
            "plateNumber": session["plate_number"],
            "parkingSpace": session["parking_space_id"],
            "hours": hours,
            "duration": duration,
            "elapsedMilliseconds": elapsed_ms,
            "amount": float(amount),
            "paymentMethod": payment_method,
            "entryTime": _datetime_to_iso(session["started_at"]),
            "paidAt": now.isoformat(),
            "status": "PAID",
        }
    except Exception:
        connection.rollback()
        raise
    finally:
        if cursor is not None:
            cursor.close()
        if connection.is_connected():
            connection.close()


def _execute_sql_file(file_path: Path, database_name: str | None = None):
    if not file_path.exists():
        return

    sql_text = file_path.read_text(encoding="utf-8")
    statements = []
    current = []

    for line in sql_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.upper().startswith("USE "):
            current.append(stripped)
            continue
        current.append(line)
        if line.rstrip().endswith(";"):
            statement = "\n".join(current).strip()
            if statement:
                statements.append(statement)
            current = []

    if current:
        statement = "\n".join(current).strip()
        if statement:
            statements.append(statement)

    conn = mysql.connector.connect(
        host=get_mysql_config()["host"],
        port=get_mysql_config()["port"],
        user=get_mysql_config()["user"],
        password=get_mysql_config()["password"],
        autocommit=True,
    )
    try:
        with conn.cursor() as cursor:
            for statement in statements:
                if not statement:
                    continue
                if statement.upper().startswith("USE "):
                    continue
                if statement.upper().startswith("CREATE DATABASE"):
                    continue
                if database_name:
                    cursor.execute(f"USE `{database_name}`;")
                cursor.execute(statement)
    finally:
        conn.close()


def _ensure_unique_session_indexes(cursor):
    for index_name, column_name in (
        ("uq_active_session_plate", "plate_number"),
        ("uq_active_session_space", "parking_space_id"),
    ):
        cursor.execute("SHOW INDEX FROM parking_sessions WHERE Key_name = %s", (index_name,))
        if cursor.fetchone() is None:
            cursor.execute(
                f"CREATE UNIQUE INDEX `{index_name}` ON parking_sessions (`{column_name}`)"
            )


def initialize_database():
    config = get_mysql_config()
    database_name = config["database"]
    connection = None
    cursor = None

    try:
        if not re.fullmatch(r"[A-Za-z0-9_$-]+", database_name):
            raise ValueError("MYSQL_DATABASE contains unsupported characters.")
        connection = mysql.connector.connect(
            host=config["host"],
            port=config["port"],
            user=config["user"],
            password=config["password"],
            autocommit=True,
        )
        cursor = connection.cursor()
        cursor.execute(
            f"CREATE DATABASE IF NOT EXISTS `{database_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
        )
        cursor.close()
        cursor = None
        connection.close()
        connection = None

        connection = get_connection(database=database_name)
        cursor = connection.cursor()
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS admins ("
            "id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
            "email VARCHAR(190) NOT NULL UNIQUE,"
            "password_hash VARCHAR(255) NOT NULL,"
            "full_name VARCHAR(100) NOT NULL DEFAULT 'Administrator',"
            "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
            ")"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS settings ("
            "id TINYINT UNSIGNED PRIMARY KEY,"
            "hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 10.00,"
            "cash_enabled BOOLEAN NOT NULL DEFAULT TRUE,"
            "online_enabled BOOLEAN NOT NULL DEFAULT TRUE,"
            "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
            ")"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS parking_spaces ("
            "id VARCHAR(10) PRIMARY KEY,"
            "status ENUM('available','occupied') NOT NULL DEFAULT 'available',"
            "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
            ")"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS parking_sessions ("
            "id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
            "session_code VARCHAR(30) NOT NULL UNIQUE,"
            "plate_number VARCHAR(30) NOT NULL,"
            "parking_space_id VARCHAR(10) NOT NULL,"
            "started_at DATETIME NOT NULL,"
            "UNIQUE KEY uq_active_session_plate (plate_number),"
            "UNIQUE KEY uq_active_session_space (parking_space_id),"
            "FOREIGN KEY (parking_space_id) REFERENCES parking_spaces(id)"
            ")"
        )
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS tickets ("
            "id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
            "ticket_number VARCHAR(30) NOT NULL UNIQUE,"
            "session_code VARCHAR(30) NOT NULL,"
            "plate_number VARCHAR(30) NOT NULL,"
            "parking_space_id VARCHAR(10) NOT NULL,"
            "hours INT UNSIGNED NOT NULL,"
            "duration_text VARCHAR(100) NOT NULL,"
            "amount DECIMAL(10,2) NOT NULL,"
            "payment_method ENUM('cash','online') NOT NULL,"
            "entry_time DATETIME NOT NULL,"
            "paid_at DATETIME NOT NULL,"
            "status VARCHAR(20) NOT NULL DEFAULT 'PAID',"
            "FOREIGN KEY (parking_space_id) REFERENCES parking_spaces(id),"
            "INDEX idx_ticket_plate (plate_number),"
            "INDEX idx_ticket_paid_at (paid_at)"
            ")"
        )
        _ensure_unique_session_indexes(cursor)
        cursor.execute(
            "INSERT INTO settings (id, hourly_rate, cash_enabled, online_enabled) VALUES (1, 10.00, TRUE, TRUE) "
            "ON DUPLICATE KEY UPDATE id = id"
        )
        cursor.executemany(
            "INSERT IGNORE INTO parking_spaces (id, status) VALUES (%s, 'available')",
            [
                (f"{chr(65 + index // 10)}{index % 10 + 1:02d}",)
                for index in range(100)
            ],
        )
        cursor.close()
        cursor = None
        connection.close()
        connection = None
        _execute_sql_file(SQL_FILE, database_name)

        return True
    except (MySQLError, ValueError) as exc:
        print(f"MySQL initialization failed: {exc}")
        return False
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()


def ensure_default_admin(email: str, password: str):
    from werkzeug.security import generate_password_hash

    connection = None
    cursor = None
    try:
        connection = get_connection()
        cursor = connection.cursor()
        cursor.execute(
            "INSERT INTO admins (email, password_hash, full_name) VALUES (%s, %s, %s) "
            "ON DUPLICATE KEY UPDATE email = VALUES(email)",
            (email.strip().lower(), generate_password_hash(password), "Administrator"),
        )
        return True
    except MySQLError as exc:
        print(f"Failed to create default admin account: {exc}")
        return False
    finally:
        if cursor is not None:
            cursor.close()
        if connection is not None and connection.is_connected():
            connection.close()
